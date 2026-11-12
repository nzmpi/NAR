import { mulDivFloor } from "./fixed.js";
import { EARLY_FEE_BPS } from "./actions.js";
import { sharesForWithdrawal, valueOfShares, type PoolState } from "./pools.js";

export interface FinalizedLot {
    burnShares: bigint; // shares actually burned from the lot
    burnValueUsd: bigint; // USD that leaves the pool for those shares
    grossUsd: bigint; // gross credited to the withdrawal (<= quoted gross)
    feeUsd: bigint; // early-withdrawal fee (10% of gross) if early
    netUsd: bigint; // what the user is paid
}

// Called at payment time, after settlement, with current pool prices.
// The quoted gross is honoured whenever the reserved shares still cover it.
// If the price fell and they no longer do, the gross shrinks to what the
// reserved shares are worth. If the price rose, only the needed shares are
// burned and the rest stay in the lot.
// The pool pays out `burnValueUsd`; the caller credits
// (burnValueUsd - netUsd) to the manager pool (fee plus rounding dust).
export function finalizeWithdrawalLot(
    pool: PoolState,
    reservedShares: bigint,
    quotedGrossUsd: bigint,
    early: boolean,
): FinalizedLot {
    const needed = sharesForWithdrawal(pool, quotedGrossUsd);
    const burnShares = needed <= reservedShares ? needed : reservedShares;
    const burnValueUsd =
        burnShares === pool.shares
            ? pool.assets
            : valueOfShares(pool, burnShares);
    const grossUsd =
        burnValueUsd < quotedGrossUsd ? burnValueUsd : quotedGrossUsd;
    const feeUsd = early ? mulDivFloor(grossUsd, EARLY_FEE_BPS, 10_000n) : 0n;
    return {
        burnShares,
        burnValueUsd,
        grossUsd,
        feeUsd,
        netUsd: grossUsd - feeUsd,
    };
}
