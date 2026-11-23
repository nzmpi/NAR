import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import {
    auditLogs,
    positionBonuses,
    positionLots,
    settlementAllocations,
    settlements,
} from "../db/schema.js";
import {
    settle,
    type BonusRequest,
    type LotInput,
} from "../accounting/settle.js";
import { applyMaturity } from "../accounting/actions.js";
import {
    APY_BPS,
    LOCK_KEYS,
    clonePools,
    totalAssets,
    valueOfShares,
    type PoolKey,
    type Pools,
} from "../accounting/pools.js";
import { AppError } from "../errors.js";
import { postLedger, type LedgerLine } from "./ledger.js";
import { loadPoolsForUpdate, savePools, type PoolIds } from "./poolStore.js";
import { fromSeconds, toSeconds } from "./time.js";
import type { Database, Tx } from "./types.js";
import { applyPendingRelocks } from "./relocks.js";
import { snapshotBalances } from "./history.js";

export interface SettleOptions {
    adminId: string | null;
    // Operator-entered current total USD value of ALL managed funds
    // (all five pools incl. manager and accumulated fees), in micro-USD.
    reportedTotalUsd: bigint;
    bonuses?: { lotId: string; amountUsd: bigint }[];
    note?: string;
    kind?: "manual" | "pre_action";
    // Required when the reported total moves NAV by more than LARGE_MOVE_BPS.
    confirmLargeMove?: boolean;
    now?: Date; // server time; injectable for tests only
}

// A typo in the reported total cannot be undone: a too-low total takes a loss
// from user pools, and the recovery above fixed APY goes to the manager pool.
export const LARGE_MOVE_BPS = 1_000n; // 10%, same as the dashboard warning
const YEAR_MS = 365 * 86_400_000;

export interface SettleOutcome {
    settlementId: string;
    pnlUsd: bigint;
    pools: Pools; // final state (after maturity conversions), already saved
    ids: PoolIds;
    now: Date;
    convertedLots: string[];
}

// Runs inside the caller's transaction. Locks all pool rows, settles at
// server time, converts matured lots to liquid, saves pools, posts ledger.
export async function settleInTx(
    tx: Tx,
    o: SettleOptions,
): Promise<SettleOutcome> {
    const now = o.now ?? new Date();
    const { pools: before, ids } = await loadPoolsForUpdate(tx);
    const keyById = new Map(
        Object.entries(ids).map(([k, id]) => [id, k as PoolKey]),
    );

    // Interval start: last settlement, else earliest lot, else now.
    const [last] = await tx
        .select({ settledAt: settlements.settledAt })
        .from(settlements)
        .orderBy(desc(settlements.settledAt))
        .limit(1);
    let intervalStart = now;
    if (last) {
        intervalStart = last.settledAt;
    } else {
        const [first] = await tx
            .select({ openedAt: positionLots.openedAt })
            .from(positionLots)
            .orderBy(positionLots.openedAt)
            .limit(1);
        if (first) intervalStart = first.openedAt;
    }
    if (now.getTime() < intervalStart.getTime())
        throw new AppError("Settlement cannot be backdated", 409, "backdated");

    const prevTotal = totalAssets(before);
    const move = o.reportedTotalUsd - prevTotal;
    if (
        !o.confirmLargeMove &&
        prevTotal > 0n &&
        (move < 0n ? -move : move) * 10_000n > prevTotal * LARGE_MOVE_BPS
    )
        throw new AppError(
            "The reported total changes managed funds by more than 10%. Check it, then run a manual settlement with the large-change confirmation first.",
            409,
            "large_move",
        );

    // Lots that have matured but are still in lock pools. Lots with a pending
    // withdrawal reservation stay put until it is resolved; they are treated
    // as liquid (matured) from the interval start once released.
    const lockPoolIds = LOCK_KEYS.map((k) => ids[k]);
    const maturedAll = await tx
        .select()
        .from(positionLots)
        .where(
            and(
                inArray(positionLots.poolId, lockPoolIds),
                isNull(positionLots.closedAt),
                lte(positionLots.maturesAt, now),
            ),
        )
        .orderBy(positionLots.id);
    const matured = maturedAll.filter((l) => BigInt(l.reservedShares) === 0n);
    const t0 = toSeconds(intervalStart);
    const t1 = toSeconds(now);

    // Every open user lot with its yearly cap state. A lot-year starts at
    // openedAt (maturity and relock lots inherit it from their parent); at
    // each anniversary the base resets to the lot's value.
    // shortcut: the anniversary is applied at the first settlement after it,
    // fine while settlements are frequent.
    const userLots = await tx
        .select()
        .from(positionLots)
        .where(
            and(
                inArray(
                    positionLots.poolId,
                    (["liquid", ...LOCK_KEYS] as const).map((k) => ids[k]),
                ),
                isNull(positionLots.closedAt),
            ),
        )
        .orderBy(positionLots.id)
        .for("update");
    const capState = new Map<
        string,
        { yearStart: Date; base: bigint; used: bigint }
    >();
    const lotInputs: LotInput[] = [];
    for (const l of userLots) {
        const key = keyById.get(l.poolId) as LotInput["poolKey"];
        const value = valueOfShares(before[key], BigInt(l.shares));
        let yearStart = l.capYearStart ?? l.openedAt;
        let base = l.capBaseUsd === null ? value : BigInt(l.capBaseUsd);
        let used = BigInt(l.capUsedUsd);
        while (now.getTime() >= yearStart.getTime() + YEAR_MS) {
            yearStart = new Date(yearStart.getTime() + YEAR_MS);
            base = value;
            used = 0n;
        }
        capState.set(l.id, { yearStart, base, used });
        // A lock that matured inside the interval earns its tier rate until
        // maturity and the liquid rate after it.
        let apyBps = APY_BPS[key];
        if (key !== "liquid" && l.maturesAt && t1 > t0) {
            let m = toSeconds(l.maturesAt);
            if (m < t0) m = t0;
            if (m < t1)
                apyBps = Number(
                    (BigInt(APY_BPS[key]) * (m - t0) +
                        BigInt(APY_BPS.liquid) * (t1 - m)) /
                        (t1 - t0),
                );
        }
        lotInputs.push({
            lotId: l.id,
            poolKey: key,
            shares: BigInt(l.shares),
            apyBps,
            capLeftUsd: (base * BigInt(APY_BPS[key])) / 10_000n - used,
        });
    }

    // Bonus requests -> pool keys from the lots.
    const bonusReqs: BonusRequest[] = [];
    const bonusLots = o.bonuses?.length
        ? await tx
              .select()
              .from(positionLots)
              .where(
                  inArray(
                      positionLots.id,
                      o.bonuses.map((b) => b.lotId),
                  ),
              )
        : [];
    if (o.bonuses?.length && !o.adminId)
        throw new AppError(
            "Bonuses require an administrator",
            403,
            "forbidden",
        );
    for (const b of o.bonuses ?? []) {
        const lot = bonusLots.find((l) => l.id === b.lotId);
        if (!lot || lot.closedAt)
            throw new AppError(
                "Bonus lot not found or closed",
                404,
                "lot_not_found",
            );
        const key = keyById.get(lot.poolId)!;
        if (key === "manager")
            throw new AppError(
                "Bonus lot cannot be in the manager pool",
                400,
                "bad_bonus",
            );
        bonusReqs.push({
            lotId: b.lotId,
            poolKey: key,
            amountUsd: b.amountUsd,
        });
    }

    let result;
    try {
        result = settle({
            pools: before,
            reportedTotalUsd: o.reportedTotalUsd,
            intervalStart: toSeconds(intervalStart),
            settledAt: toSeconds(now),
            lots: lotInputs,
            bonuses: bonusReqs,
        });
    } catch (e) {
        throw new AppError((e as Error).message, 400, "settlement_rejected");
    }

    const [s] = await tx
        .insert(settlements)
        .values({
            kind: o.kind ?? "manual",
            previousTotalAssetsUsd: totalAssets(before).toString(),
            reportedTotalAssetsUsd: o.reportedTotalUsd.toString(),
            pnlUsd: result.pnlUsd.toString(),
            intervalStart: fromSeconds(toSeconds(intervalStart)),
            settledAt: now,
            adminId: o.adminId,
            note: o.note ?? null,
        })
        .returning({ id: settlements.id });

    if (result.allocations.length) {
        await tx.insert(settlementAllocations).values(
            result.allocations.map((a) => ({
                settlementId: s.id,
                poolId: ids[a.poolKey],
                kind: a.kind,
                amountUsd: a.amountUsd.toString(),
                navBeforeUsd: before[a.poolKey].assets.toString(),
                navAfterUsd: result.pools[a.poolKey].assets.toString(),
                sharesAfter: result.pools[a.poolKey].shares.toString(),
            })),
        );
    }

    // Settlement ledger: pool_equity moves by each allocation; managed_funds
    // carries the net P&L.
    const lines: LedgerLine[] = result.allocations.map((a) => ({
        account: "pool_equity",
        poolId: ids[a.poolKey],
        direction: a.amountUsd >= 0n ? "credit" : "debit",
        amountUsd: a.amountUsd >= 0n ? a.amountUsd : -a.amountUsd,
    }));
    if (result.pnlUsd !== 0n)
        lines.push({
            account: "managed_funds",
            direction: result.pnlUsd > 0n ? "debit" : "credit",
            amountUsd: result.pnlUsd > 0n ? result.pnlUsd : -result.pnlUsd,
        });
    await postLedger(tx, {
        type: "settlement",
        referenceType: "settlement",
        referenceId: s.id,
        adminId: o.adminId,
        lines,
    });

    // Yield shares go to each lot; cap state is saved for every lot.
    const creditByLot = new Map(result.lotCredits.map((c) => [c.lotId, c]));
    for (const l of userLots) {
        const c = creditByLot.get(l.id);
        const st = capState.get(l.id)!;
        await tx
            .update(positionLots)
            .set({
                shares: sql`${positionLots.shares} + ${(c?.sharesMinted ?? 0n).toString()}::numeric`,
                capYearStart: st.yearStart,
                capBaseUsd: st.base.toString(),
                capUsedUsd: (st.used + (c?.amountUsd ?? 0n)).toString(),
                updatedAt: now,
            })
            .where(eq(positionLots.id, l.id));
    }

    // Bonus shares go to the chosen lot.
    for (const bm of result.bonusMints) {
        const lot = bonusLots.find((l) => l.id === bm.lotId)!;
        await tx
            .update(positionLots)
            .set({
                shares: sql`${positionLots.shares} + ${bm.sharesMinted.toString()}::numeric`,
                updatedAt: now,
            })
            .where(eq(positionLots.id, lot.id));
        await tx.insert(positionBonuses).values({
            settlementId: s.id,
            positionLotId: lot.id,
            amountUsd: bm.amountUsd.toString(),
            mintedShares: bm.sharesMinted.toString(),
            grantedByAdminId: o.adminId!,
        });
    }

    // Convert matured lots to liquid at current value (reload bonus-updated shares).
    let state = clonePools(result.pools);
    const converted: string[] = [];
    if (matured.length) {
        const fresh = await tx
            .select()
            .from(positionLots)
            .where(
                inArray(
                    positionLots.id,
                    matured.map((l) => l.id),
                ),
            )
            .orderBy(positionLots.id);
        for (const lot of fresh) {
            const key = keyById.get(lot.poolId)!;
            const r = applyMaturity(state, key, BigInt(lot.shares));
            state = r.pools;
            await tx
                .update(positionLots)
                .set({ shares: "0", closedAt: now, updatedAt: now })
                .where(eq(positionLots.id, lot.id));
            await tx.insert(positionLots).values({
                userId: lot.userId,
                poolId: ids.liquid,
                shares: r.liquidShares.toString(),
                principalUsd: lot.principalUsd,
                openedAt: now,
                maturesAt: null,
                sourceType: "maturity",
                sourceId: lot.id,
                parentLotId: lot.id,
                // Same lot-year and cap use; only the rate changes to liquid.
                capYearStart: lot.capYearStart,
                capBaseUsd: lot.capBaseUsd,
                capUsedUsd: lot.capUsedUsd,
            });
            await postLedger(tx, {
                type: "maturity",
                referenceType: "position_lot",
                referenceId: lot.id,
                adminId: o.adminId,
                lines: [
                    {
                        account: "pool_equity",
                        poolId: ids[key],
                        direction: "debit",
                        amountUsd: r.usd,
                        userId: lot.userId,
                    },
                    {
                        account: "pool_equity",
                        poolId: ids.liquid,
                        direction: "credit",
                        amountUsd: r.usd,
                        userId: lot.userId,
                    },
                ],
            });
            converted.push(lot.id);
        }
    }

    // Queued relocks are applied at this settlement's prices.
    const relocks = await applyPendingRelocks(tx, {
        state,
        ids,
        now,
        settlementId: s.id,
        adminId: o.adminId,
    });
    state = relocks.state;
    await snapshotBalances(tx, { state, ids, settlementId: s.id, now });

    await savePools(tx, ids, state);
    if (totalAssets(state) !== o.reportedTotalUsd)
        throw new Error(
            "invariant: pool NAVs != reported total after conversion",
        );

    if (o.adminId)
        await tx.insert(auditLogs).values({
            adminId: o.adminId,
            action: "settlement.recorded",
            entityType: "settlement",
            entityId: s.id,
            details: {
                reportedTotalUsd: o.reportedTotalUsd.toString(),
                pnlUsd: result.pnlUsd.toString(),
                bonuses: result.bonusMints.map((b) => ({
                    ...b,
                    amountUsd: b.amountUsd.toString(),
                    sharesMinted: b.sharesMinted.toString(),
                })),
                convertedLots: converted,
                note: o.note ?? null,
            },
        });

    return {
        settlementId: s.id,
        pnlUsd: result.pnlUsd,
        pools: state,
        ids,
        now,
        convertedLots: converted,
    };
}

// Operator records current total NAV (optionally with one-time bonuses).
export function settleManual(
    database: Database,
    o: Omit<SettleOptions, "kind">,
) {
    return database.transaction((tx) =>
        settleInTx(tx, { ...o, kind: "manual" }),
    );
}
