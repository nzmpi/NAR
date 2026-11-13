import { eq, inArray, isNull, sql } from "drizzle-orm";
import {
    poolSnapshots,
    pools,
    positionLots,
    settlementAllocations,
    settlements,
    userBalanceSnapshots,
    userFlows,
} from "../db/schema.js";
import { SHARE_SCALE } from "../accounting/fixed.js";
import {
    POOL_KEYS,
    valueOfShares,
    type PoolKey,
    type Pools,
} from "../accounting/pools.js";
import type { PoolIds } from "./poolStore.js";
import type { Database, Tx } from "./types.js";

/* ----------------------------- writing ----------------------------- */

// Called by settleInTx after the settlement, maturities and relocks are
// applied (lots already updated in this transaction), before flows.
export async function snapshotBalances(
    tx: Tx,
    c: {
        state: Pools;
        ids: PoolIds;
        settlementId: string;
        now: Date;
    },
) {
    const keyById = new Map(
        Object.entries(c.ids).map(([k, id]) => [id, k as PoolKey]),
    );
    const lots = await tx
        .select({
            userId: positionLots.userId,
            poolId: positionLots.poolId,
            shares: positionLots.shares,
            principalUsd: positionLots.principalUsd,
        })
        .from(positionLots)
        .where(isNull(positionLots.closedAt));

    const agg = new Map<
        string,
        { value: bigint; principal: bigint; liquid: bigint; locked: bigint }
    >();
    for (const l of lots) {
        const key = keyById.get(l.poolId)!;
        if (key === "manager") continue;
        const value = valueOfShares(c.state[key], BigInt(l.shares));
        const a = agg.get(l.userId) ?? {
            value: 0n,
            principal: 0n,
            liquid: 0n,
            locked: 0n,
        };
        a.value += value;
        a.principal += BigInt(l.principalUsd);
        if (key === "liquid") a.liquid += value;
        else a.locked += value;
        agg.set(l.userId, a);
    }

    const rows = [...agg.entries()]
        .filter(([, a]) => a.value > 0n)
        .map(([userId, a]) => ({
            userId,
            settlementId: c.settlementId,
            takenAt: c.now,
            valueUsd: a.value.toString(),
            principalUsd: a.principal.toString(),
            liquidValueUsd: a.liquid.toString(),
            lockedValueUsd: a.locked.toString(),
        }));
    for (let i = 0; i < rows.length; i += 500)
        await tx.insert(userBalanceSnapshots).values(rows.slice(i, i + 500));

    await tx.insert(poolSnapshots).values(
        POOL_KEYS.map((k) => ({
            settlementId: c.settlementId,
            poolId: c.ids[k],
            takenAt: c.now,
            totalAssetsUsd: c.state[k].assets.toString(),
            totalShares: c.state[k].shares.toString(),
        })),
    );
}

// Record an external flow right after the action's pre-settlement.
// Do not record manager-pool movements.
export async function recordFlow(
    tx: Tx,
    f: {
        userId: string;
        settlementId: string;
        kind: "deposit" | "withdrawal";
        amountUsd: bigint;
    },
) {
    await tx.insert(userFlows).values({
        userId: f.userId,
        settlementId: f.settlementId,
        kind: f.kind,
        amountUsd: f.amountUsd.toString(),
    });
}

/* ----------------------------- reading ----------------------------- */
// Analytics for display only (floating point is fine here; accounting is not).

export type PerfRange = "1w" | "1m" | "3m" | "1y" | "all";
const RANGE_DAYS: Record<Exclude<PerfRange, "all">, number> = {
    "1w": 7,
    "1m": 30,
    "3m": 90,
    "1y": 365,
};
const YEAR_SECONDS = 365 * 86_400;
const MIN_APY_SECONDS = 86_400; // under a day: no annualized figure
const MIN_BASE_USD = 1_000_000n; // ignore dust balances as a return base

const ratioNum = (num: bigint, den: bigint): number =>
    Number((num * 10n ** 12n) / den) / 1e12;

interface Node {
    t: Date;
    ratioFromPrev: number | null;
}

// Chain-links sub-period returns inside the window. The window starts at the
// last point at or before (now - range), else at the first point.
function summarize(nodes: Node[], range: PerfRange, now: Date) {
    if (nodes.length === 0)
        return {
            startIdx: 0,
            index: [] as number[],
            from: null,
            to: null,
            cumulativeReturn: null,
            apy: null,
        };

    let startIdx = 0;
    if (range !== "all") {
        const start = now.getTime() - RANGE_DAYS[range] * 86_400_000;
        for (let i = 0; i < nodes.length; i++)
            if (nodes[i].t.getTime() <= start) startIdx = i;
    }
    const index: number[] = [];
    index[startIdx] = 1;
    for (let j = startIdx + 1; j < nodes.length; j++)
        index[j] = index[j - 1] * (nodes[j].ratioFromPrev ?? 1);

    const last = nodes.length - 1;
    const elapsed =
        (nodes[last].t.getTime() - nodes[startIdx].t.getTime()) / 1000;
    const total = index[last];
    return {
        startIdx,
        index,
        from: nodes[startIdx].t,
        to: nodes[last].t,
        cumulativeReturn: total - 1,
        apy:
            elapsed >= MIN_APY_SECONDS
                ? Math.pow(total, YEAR_SECONDS / elapsed) - 1
                : null,
    };
}

// User performance: time-weighted return between settlements, adjusted for
// deposits and withdrawals (flows). Relocks and maturities are value-neutral.
// Can be negative. Uses only the user's own data.
export async function computePerformance(
    database: Database,
    userId: string,
    range: PerfRange,
    now = new Date(),
) {
    const snaps = await database
        .select()
        .from(userBalanceSnapshots)
        .where(eq(userBalanceSnapshots.userId, userId));
    const flows = await database
        .select()
        .from(userFlows)
        .where(eq(userFlows.userId, userId));

    const flowBy = new Map<string, bigint>();
    for (const f of flows)
        flowBy.set(
            f.settlementId,
            (flowBy.get(f.settlementId) ?? 0n) + BigInt(f.amountUsd),
        );
    const times = new Map<string, Date>();
    const value = new Map<string, bigint>();
    for (const s of snaps) {
        times.set(s.settlementId, s.takenAt);
        value.set(s.settlementId, BigInt(s.valueUsd));
    }
    const missing = [...flowBy.keys()].filter((id) => !times.has(id));
    if (missing.length) {
        const rows = await database
            .select({ id: settlements.id, settledAt: settlements.settledAt })
            .from(settlements)
            .where(inArray(settlements.id, missing));
        for (const r of rows) times.set(r.id, r.settledAt);
    }

    const ids = [...times.keys()].sort(
        (a, b) =>
            times.get(a)!.getTime() - times.get(b)!.getTime() ||
            (a < b ? -1 : 1),
    );
    const nodes: (Node & { balanceUsd: bigint })[] = [];
    let prevBase = 0n;
    for (const id of ids) {
        const v = value.get(id) ?? 0n;
        const f = flowBy.get(id) ?? 0n;
        const ratio =
            prevBase >= MIN_BASE_USD && v > 0n ? ratioNum(v, prevBase) : null;
        nodes.push({
            t: times.get(id)!,
            ratioFromPrev: ratio,
            balanceUsd: v + f,
        });
        prevBase = v + f;
    }

    const s = summarize(nodes, range, now);
    return {
        range,
        from: s.from,
        to: s.to,
        cumulativeReturn: s.cumulativeReturn,
        apy: s.apy,
        points: nodes.slice(s.startIdx).map((n, k) => ({
            t: n.t,
            balanceUsd: n.balanceUsd,
            index: 100 * (s.index[s.startIdx + k] ?? 1),
        })),
    };
}

// Admin only: gross pool performance (share-price returns, flow independent)
// plus the settlement allocation totals in the window.
export async function adminPerformance(
    database: Database,
    range: PerfRange,
    now = new Date(),
) {
    const rows = await database
        .select({
            key: pools.key,
            takenAt: poolSnapshots.takenAt,
            assets: poolSnapshots.totalAssetsUsd,
            shares: poolSnapshots.totalShares,
        })
        .from(poolSnapshots)
        .innerJoin(pools, eq(pools.id, poolSnapshots.poolId))
        .orderBy(poolSnapshots.takenAt);

    const perPool = POOL_KEYS.map((key) => {
        const nodes: Node[] = [];
        let prev: bigint | null = null;
        for (const r of rows.filter((x) => x.key === key)) {
            const shares = BigInt(r.shares);
            if (shares === 0n) {
                prev = null;
                continue;
            }
            const price = (BigInt(r.assets) * SHARE_SCALE) / shares;
            nodes.push({
                t: r.takenAt,
                ratioFromPrev:
                    prev !== null && prev > 0n ? ratioNum(price, prev) : null,
            });
            prev = price;
        }
        const s = summarize(nodes, range, now);
        return {
            pool: key,
            from: s.from,
            to: s.to,
            cumulativeReturn: s.cumulativeReturn,
            apy: s.apy,
        };
    });

    const since =
        range === "all"
            ? new Date(0)
            : new Date(now.getTime() - RANGE_DAYS[range] * 86_400_000);
    const totals = await database
        .select({
            kind: settlementAllocations.kind,
            total: sql<string>`coalesce(sum(${settlementAllocations.amountUsd}), 0)`,
        })
        .from(settlementAllocations)
        .innerJoin(
            settlements,
            eq(settlements.id, settlementAllocations.settlementId),
        )
        .where(sql`${settlements.settledAt} >= ${since}`)
        .groupBy(settlementAllocations.kind);
    const sum = (k: string) =>
        BigInt(totals.find((t) => t.kind === k)?.total ?? "0");

    return {
        range,
        pools: perPool,
        managerExcessUsd: sum("manager_excess"),
        participantYieldUsd: sum("participant_yield"),
        lossUsd: sum("loss"),
        bonusesPaidUsd: sum("bonus_in"),
    };
}
