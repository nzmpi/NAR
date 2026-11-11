import { P, mulDivFloor } from "./fixed.js";
import { growthFactor } from "./rates.js";
import {
    APY_BPS,
    LOCK_KEYS,
    POOL_KEYS,
    clonePools,
    mint,
    totalAssets,
    valueOfShares,
    type LockKey,
    type PoolKey,
    type Pools,
} from "./pools.js";

export interface MaturedLot {
    poolKey: LockKey;
    shares: bigint;
    maturesAt: bigint; // unix seconds, must be in [intervalStart, settledAt]
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
    // Lock-pool lots that matured inside the interval but are not yet
    // converted to liquid. Lots matured before intervalStart must have been
    // converted already (convert before settling).
    maturedLots?: MaturedLot[];
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
export interface SettleResult {
    pools: Pools;
    pnlUsd: bigint;
    allocations: Allocation[];
    bonusMints: BonusMint[];
}

// Tier cap for one pool over the interval, with maturity time-weighting.
function poolCap(
    key: Exclude<PoolKey, "manager">,
    pools: Pools,
    t0: bigint,
    t1: bigint,
    matured: MaturedLot[],
): { cap: bigint; weight: bigint } {
    const nav = pools[key].assets;
    const dt = t1 - t0;
    // weight = USD * apyBps * seconds (simple, time-weighted). Used only to
    // split a profit shortfall so earnings per USD stay proportional to APY
    // (an 8% pool earns 8/6 of what a 6% pool earns per USD).
    if (key === "liquid")
        return {
            cap: mulDivFloor(nav, growthFactor(APY_BPS.liquid, dt) - P, P),
            weight: nav * BigInt(APY_BPS.liquid) * dt,
        };

    const mine = matured.filter((m) => m.poolKey === key);
    let maturedValue = 0n;
    let cap = 0n;
    let weight = 0n;
    for (const m of mine) {
        if (m.maturesAt < t0 || m.maturesAt > t1)
            throw new Error("matured lot outside interval");
        const v = valueOfShares(pools[key], m.shares);
        maturedValue += v;
        const f =
            (growthFactor(APY_BPS[key], m.maturesAt - t0) *
                growthFactor(APY_BPS.liquid, t1 - m.maturesAt)) /
            P;
        cap += mulDivFloor(v, f - P, P);
        weight +=
            v *
            (BigInt(APY_BPS[key]) * (m.maturesAt - t0) +
                BigInt(APY_BPS.liquid) * (t1 - m.maturesAt));
    }
    if (maturedValue > nav) throw new Error("matured lots exceed pool NAV");
    cap += mulDivFloor(
        nav - maturedValue,
        growthFactor(APY_BPS[key], dt) - P,
        P,
    );
    weight += (nav - maturedValue) * BigInt(APY_BPS[key]) * dt;
    return { cap, weight };
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
        const keys: Exclude<PoolKey, "manager">[] = ["liquid", ...LOCK_KEYS];
        const parts = keys.map((k) =>
            poolCap(k, before, t0, t1, input.maturedLots ?? []),
        );
        const capSum = parts.reduce((a, b) => a + b.cap, 0n);
        const weightSum = parts.reduce((a, b) => a + b.weight, 0n);
        // Profit >= caps: pay caps, manager gets the rest. Profit < caps:
        // split all profit by APY-time weight; manager gets only dust.
        const credits = parts.map((x) =>
            capSum <= pnl ? x.cap : mulDivFloor(x.weight, pnl, weightSum),
        );
        keys.forEach((k, i) => (pools[k].assets += credits[i]));
        const credited = credits.reduce((a, b) => a + b, 0n);
        const managerExcess = pnl - credited;
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
    return { pools, pnlUsd: pnl, allocations, bonusMints };
}
