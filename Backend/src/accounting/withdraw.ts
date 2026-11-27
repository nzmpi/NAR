import { mulDivFloor } from "./fixed.js";
import { EARLY_FEE_BPS } from "./actions.js";
import { sharesForWithdrawal, valueOfShares, type PoolState } from "./pools.js";

export interface LockedLot {
    burnShares: bigint; // shares taken from the lot
    burnValueUsd: bigint; // USD that leaves the pool for those shares
    grossUsd: bigint; // gross credited to the withdrawal
    feeUsd: bigint; // early-withdrawal fee (10% of gross) if early
    netUsd: bigint; // what the user is paid
}

// Fixes one lot's part of a withdrawal at lock time, after settlement, at
// current prices. The asked gross is paid whenever possible:
// - gain or no change: only the shares needed are taken; the rest of the
//   reservation goes back to the lot;
// - loss: extra shares come from the lot's free (unreserved) shares; if those
//   run out, the gross shrinks to what the user has.
// Withdraw-all takes every share of the lot that is not reserved elsewhere
// (yield arrives as new shares in the lot), so the gross follows gains and
// losses. The fee is 10% of the gross actually taken.
// The pool pays out `burnValueUsd`; the caller credits
// (burnValueUsd - netUsd) to the manager pool (fee plus rounding dust).
export function lockWithdrawalLot(
    pool: PoolState,
    reservedShares: bigint,
    freeShares: bigint,
    askedGrossUsd: bigint,
    early: boolean,
    withdrawAll: boolean,
): LockedLot {
    const have = reservedShares + freeShares;
    let burnShares = have;
    if (!withdrawAll) {
        const needed = sharesForWithdrawal(pool, askedGrossUsd);
        if (needed < have) burnShares = needed;
    }
    const burnValueUsd =
        burnShares === pool.shares
            ? pool.assets
            : valueOfShares(pool, burnShares);
    const grossUsd =
        withdrawAll || burnValueUsd < askedGrossUsd
            ? burnValueUsd
            : askedGrossUsd;
    const feeUsd = early ? mulDivFloor(grossUsd, EARLY_FEE_BPS, 10_000n) : 0n;
    return {
        burnShares,
        burnValueUsd,
        grossUsd,
        feeUsd,
        netUsd: grossUsd - feeUsd,
    };
}

// A payout more than this share below the asked gross needs the user's
// confirmation.
export const CONFIRM_LOSS_BPS = 100n; // 1%

export const needsConfirmation = (
    askedGrossUsd: bigint,
    paidGrossUsd: bigint,
) =>
    (askedGrossUsd - paidGrossUsd) * 10_000n > askedGrossUsd * CONFIRM_LOSS_BPS;
