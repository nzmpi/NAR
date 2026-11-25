import { mulDivFloor } from "./fixed.js";
import {
    burn,
    clonePools,
    mint,
    sharesForWithdrawal,
    valueOfShares,
    type PoolKey,
    type Pools,
} from "./pools.js";

export const EARLY_FEE_BPS = 1000n; // 10%

// Confirmed deposit into one pool (one call per tier split). Settle first.
export function applyDeposit(pools: Pools, poolKey: PoolKey, usd: bigint) {
    const p = clonePools(pools);
    const r = mint(p[poolKey], usd);
    p[poolKey] = r.state;
    return { pools: p, shares: r.shares };
}

// Split a confirmed USD amount by bps; remainder goes to the last entry.
export function splitByBps(
    usd: bigint,
    bps: { poolKey: PoolKey; bps: number }[],
) {
    if (bps.reduce((s, x) => s + x.bps, 0) !== 10_000)
        throw new Error("bps must sum to 10000");
    let left = usd;
    return bps.map((x, i) => {
        const amt =
            i === bps.length - 1
                ? left
                : mulDivFloor(usd, BigInt(x.bps), 10_000n);
        left -= amt;
        return { poolKey: x.poolKey, usd: amt };
    });
}

// Matured lock lot -> liquid at current value. Lock does not renew.
export function applyMaturity(
    pools: Pools,
    lockKey: PoolKey,
    lotShares: bigint,
) {
    const p = clonePools(pools);
    const b = burn(p[lockKey], lotShares);
    const m = mint(p.liquid, b.usd);
    p[lockKey] = b.state;
    p.liquid = m.state;
    return { pools: p, usd: b.usd, liquidShares: m.shares };
}

export interface WithdrawalQuote {
    sharesBurned: bigint;
    grossUsd: bigint;
    feeUsd: bigint;
    netUsd: bigint;
}

// Quote taking `grossUsd` from a lot. early=true charges 10% to manager.
export function quoteWithdrawal(
    pools: Pools,
    poolKey: PoolKey,
    lotAvailableShares: bigint,
    grossUsd: bigint,
    early: boolean,
): WithdrawalQuote {
    const s = pools[poolKey];
    // "Max" (grossUsd = the lot's floor value) always fits: ceil never needs more shares.
    const shares = sharesForWithdrawal(s, grossUsd);
    if (shares > lotAvailableShares) throw new Error("exceeds lot value");
    const gross = valueOfShares(s, shares);
    const fee = early ? mulDivFloor(gross, EARLY_FEE_BPS, 10_000n) : 0n;
    return {
        sharesBurned: shares,
        grossUsd: gross,
        feeUsd: fee,
        netUsd: gross - fee,
    };
}
