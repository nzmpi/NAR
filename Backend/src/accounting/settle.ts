import { mulDivFloor } from "./fixed.js";
import {
    POOL_KEYS,
    clonePools,
    mint,
    totalAssets,
    valueOfShares,
    type PoolKey,
    type Pools,
} from "./pools.js";

// One open user lot. The service works out its effective APY for the
// interval (time-weighted when a lock matured inside it) and how much of its
// cap is left (capAllowanceUsd minus what it has used this lot-year).
export interface LotInput {
    lotId: string;
    poolKey: Exclude<PoolKey, "manager">;
    shares: bigint;
    apyBps: number;
    capLeftUsd: bigint;
}
export interface BonusRequest {
    lotId: string;
    poolKey: Exclude<PoolKey, "manager">;
    amountUsd: bigint;
}
export interface SettleInput {
    pools: Pools;
    reportedTotalUsd: bigint;
    intervalStart: bigint; // unix seconds (last settlement)
    settledAt: bigint; // unix seconds (server time)
    lots?: LotInput[];
    bonuses?: BonusRequest[];
}
export type AllocKind =
    "loss" | "participant_yield" | "manager_excess" | "bonus_out" | "bonus_in";
export interface Allocation {
    poolKey: PoolKey;
    kind: AllocKind;
    amountUsd: bigint; // signed
}
export interface BonusMint {
    lotId: string;
    poolKey: PoolKey;
    amountUsd: bigint;
    sharesMinted: bigint;
}
export interface LotCredit {
    lotId: string;
    poolKey: PoolKey;
    amountUsd: bigint;
    sharesMinted: bigint;
}
export interface SettleResult {
    pools: Pools;
    pnlUsd: bigint;
    allocations: Allocation[];
    bonusMints: BonusMint[];
    lotCredits: LotCredit[];
}

// Above its cap a lot keeps this fraction of its share.
export const OVER_CAP_DIVISOR = 10n;

const WEEK_SECONDS = 7n * 86_400n;

// Cap a lot may have earned so far in its lot-year. Each started 7-day week
// adds yearly cap * 7/365; unused cap carries over until the yearly reset,
// and the last (partial) week tops it up to exactly base * APY.
export function capAllowanceUsd(
    base: bigint,
    apyBps: number,
    secondsIntoYear: bigint,
): bigint {
    if (base <= 0n) return 0n;
    let days = (secondsIntoYear / WEEK_SECONDS + 1n) * 7n;
    if (days > 365n) days = 365n;
    return (base * BigInt(apyBps) * days) / (10_000n * 365n);
}

// Splits positive P&L. The manager pool takes its NAV share. User lots split
// the rest by value * APY; each lot gets its share in full while under its
// cap, and 1/10 of the part above it. The other 9/10 and rounding
// dust go to the manager.
export function lotCredits(
    pools: Pools,
    pnl: bigint,
    lots: LotInput[],
): { lotId: string; poolKey: LotInput["poolKey"]; amountUsd: bigint }[] {
    const prevTotal = totalAssets(pools);
    const managerShare =
        prevTotal > 0n ? mulDivFloor(pnl, pools.manager.assets, prevTotal) : 0n;
    const userPart = pnl - managerShare;
    const weights = lots.map(
        (l) => valueOfShares(pools[l.poolKey], l.shares) * BigInt(l.apyBps),
    );
    const weightSum = weights.reduce((a, b) => a + b, 0n);
    if (weightSum === 0n) return [];
    return lots.map((l, i) => {
        const share = mulDivFloor(userPart, weights[i], weightSum);
        const left = l.capLeftUsd > 0n ? l.capLeftUsd : 0n;
        const full = share < left ? share : left;
        return {
            lotId: l.lotId,
            poolKey: l.poolKey,
            amountUsd: full + (share - full) / OVER_CAP_DIVISOR,
        };
    });
}

export function settle(input: SettleInput): SettleResult {
    const {
        reportedTotalUsd: reported,
        intervalStart: t0,
        settledAt: t1,
    } = input;
    if (reported < 0n) throw new Error("reported total must be non-negative");
    if (t1 < t0) throw new Error("settlement cannot be backdated");

    const before = input.pools;
    const pools = clonePools(before);
    const prevTotal = totalAssets(before);
    const pnl = reported - prevTotal;
    const allocations: Allocation[] = [];
    const bonusMints: BonusMint[] = [];
    const lotMints: LotCredit[] = [];
    const bonuses = input.bonuses ?? [];

    if (pnl < 0n) {
        // Same percentage loss everywhere; rounding dust stays with manager.
        if (bonuses.length) throw new Error("bonuses need positive P&L");
        for (const k of POOL_KEYS) {
            if (k === "manager") continue;
            pools[k].assets = mulDivFloor(
                before[k].assets,
                reported,
                prevTotal,
            );
        }
        const others = POOL_KEYS.filter((k) => k !== "manager").reduce(
            (s, k) => s + pools[k].assets,
            0n,
        );
        pools.manager.assets = reported - others;
    } else if (pnl > 0n) {
        const credits = lotCredits(before, pnl, input.lots ?? []);
        for (const c of credits) {
            if (c.amountUsd <= 0n) continue;
            const r = mint(pools[c.poolKey], c.amountUsd);
            pools[c.poolKey] = r.state;
            lotMints.push({ ...c, sharesMinted: r.shares });
        }
        const credited = credits.reduce((a, c) => a + c.amountUsd, 0n);
        const managerExcess = pnl - credited;
        if (managerExcess > 0n && before.manager.shares === 0n)
            throw new Error(
                "manager pool has no shares to receive excess profit",
            );
        pools.manager.assets += managerExcess;

        // One-time bonuses: move value manager -> lot's pool, mint to that lot.
        const bonusTotal = bonuses.reduce((s, b) => s + b.amountUsd, 0n);
        if (bonusTotal > managerExcess)
            throw new Error("bonuses exceed manager excess");
        for (const b of bonuses) {
            if (b.amountUsd <= 0n) throw new Error("bonus must be positive");
            if (pools[b.poolKey].shares === 0n)
                throw new Error("bonus pool has no shares");
            const r = mint(pools[b.poolKey], b.amountUsd);
            pools[b.poolKey] = r.state;
            pools.manager.assets -= b.amountUsd;
            bonusMints.push({
                lotId: b.lotId,
                poolKey: b.poolKey,
                amountUsd: b.amountUsd,
                sharesMinted: r.shares,
            });
        }
    } else if (bonuses.length) {
        throw new Error("bonuses need positive P&L");
    }

    const delta = (k: PoolKey) => pools[k].assets - before[k].assets;
    const bonusIn = (k: PoolKey) =>
        bonusMints
            .filter((b) => b.poolKey === k)
            .reduce((s, b) => s + b.amountUsd, 0n);
    const bonusOut = bonusMints.reduce((s, b) => s + b.amountUsd, 0n);
    for (const k of POOL_KEYS) {
        if (k === "manager") {
            const d = delta(k) + bonusOut;
            if (d !== 0n)
                allocations.push({
                    poolKey: k,
                    kind: pnl < 0n ? "loss" : "manager_excess",
                    amountUsd: d,
                });
            if (bonusOut)
                allocations.push({
                    poolKey: k,
                    kind: "bonus_out",
                    amountUsd: -bonusOut,
                });
        } else {
            const bi = bonusIn(k);
            const d = delta(k) - bi;
            if (d !== 0n)
                allocations.push({
                    poolKey: k,
                    kind: pnl < 0n ? "loss" : "participant_yield",
                    amountUsd: d,
                });
            if (bi)
                allocations.push({
                    poolKey: k,
                    kind: "bonus_in",
                    amountUsd: bi,
                });
        }
    }

    for (const k of POOL_KEYS)
        if (pools[k].shares > 0n && pools[k].assets === 0n)
            throw new Error(
                "settlement would wipe out a pool; check reported total",
            );
    if (totalAssets(pools) !== reported)
        throw new Error("invariant: pool NAVs != reported total");
    return {
        pools,
        pnlUsd: pnl,
        allocations,
        bonusMints,
        lotCredits: lotMints,
    };
}
