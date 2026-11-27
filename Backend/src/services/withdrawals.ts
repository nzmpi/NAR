import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
    admins,
    assets,
    auditLogs,
    chains,
    payoutAddresses,
    positionLots,
    settlements,
    users,
    vaults,
    withdrawalAllocations,
    withdrawals,
} from "../db/schema.js";
import { isAddress } from "viem";
import { USD_MICRO } from "../accounting/fixed.js";
import { quoteWithdrawal } from "../accounting/actions.js";
import {
    lockWithdrawalLot,
    needsConfirmation,
} from "../accounting/withdraw.js";
import {
    LOCK_KEYS,
    STABLES,
    TX_HASH,
    burn,
    clonePools,
    mint,
    valueOfShares,
    type LockKey,
    type PoolKey,
    type Pools,
} from "../accounting/pools.js";
import { AppError } from "../errors.js";
import { postLedger, type LedgerLine } from "./ledger.js";
import { loadPoolsForUpdate, savePools, type PoolIds } from "./poolStore.js";
import { settleInTx } from "./settlement.js";
import type { Database, Tx } from "./types.js";
import { recordFlow } from "./history.js";

export const MIN_WITHDRAWAL_USD = 5n * USD_MICRO;

const usdToToken = (usd: bigint, decimals: number): bigint =>
    (usd * 10n ** BigInt(decimals)) / USD_MICRO;

export interface LockSelection {
    lotId: string;
    grossUsd?: bigint; // micro-USD gross value to take from this lock
    max?: boolean; // take the lot's whole available value
}

export interface WithdrawalRequestInput {
    userId: string;
    assetId: string; // chosen chain + stablecoin
    destinationAddress: string;
    // Total gross value requested (micro-USD). Liquid balance is used first;
    // lockSelections must cover exactly the remainder.
    amountUsd: bigint;
    lockSelections?: LockSelection[];
    // Everything available: at lock all reserved shares are paid out.
    withdrawAll?: boolean;
    now?: Date;
}

export interface PlannedLot {
    lotId: string;
    poolKey: PoolKey;
    shares: bigint;
    grossUsd: bigint;
    feeUsd: bigint;
    netUsd: bigint;
    early: boolean;
}

// Picks lots and computes the quote. Caller holds the pool and lot locks.
async function planLots(
    tx: Tx,
    i: WithdrawalRequestInput,
    pools: Pools,
    ids: PoolIds,
    now: Date,
): Promise<PlannedLot[]> {
    const keyById = new Map(
        Object.entries(ids).map(([k, id]) => [id, k as PoolKey]),
    );
    const lots = await tx
        .select()
        .from(positionLots)
        .where(
            and(
                eq(positionLots.userId, i.userId),
                isNull(positionLots.closedAt),
            ),
        )
        .orderBy(positionLots.openedAt, positionLots.id)
        .for("update");

    const info = lots
        .map((lot) => {
            const key = keyById.get(lot.poolId)!;
            const avail = BigInt(lot.shares) - BigInt(lot.reservedShares);
            const locked =
                LOCK_KEYS.includes(key as LockKey) &&
                lot.maturesAt !== null &&
                lot.maturesAt.getTime() > now.getTime();
            return { lot, key, avail, locked };
        })
        .filter((x) => x.avail > 0n);

    // Free = no fee: liquid first, then matured-but-unconverted locks, then manager.
    const rank = (k: PoolKey) => (k === "liquid" ? 0 : k === "manager" ? 2 : 1);
    const free = info
        .filter((x) => !x.locked)
        .sort((a, b) => rank(a.key) - rank(b.key));

    const planned: PlannedLot[] = [];
    let remaining = i.amountUsd;
    for (const f of free) {
        if (remaining <= 0n) break;
        const value = valueOfShares(pools[f.key], f.avail);
        const take = remaining < value ? remaining : value;
        if (take <= 0n) continue;
        const q = quoteWithdrawal(pools, f.key, f.avail, take, false);
        planned.push({
            lotId: f.lot.id,
            poolKey: f.key,
            shares: q.sharesBurned,
            grossUsd: q.grossUsd,
            feeUsd: q.feeUsd,
            netUsd: q.netUsd,
            early: false,
        });
        remaining -= take;
    }

    const sels = i.lockSelections ?? [];
    if (remaining === 0n) {
        if (sels.length)
            throw new AppError(
                "Liquid balance covers this request; remove locked selections",
                400,
                "bad_selection",
            );
    } else {
        if (!sels.length)
            throw new AppError(
                "Not enough liquid balance; choose locked positions for the remainder",
                400,
                "need_locked",
            );
        let sum = 0n;
        const seen = new Set<string>();
        for (const sel of sels) {
            if (seen.has(sel.lotId))
                throw new AppError(
                    "Duplicate locked selection",
                    400,
                    "bad_selection",
                );
            seen.add(sel.lotId);
            const x = info.find((n) => n.lot.id === sel.lotId && n.locked);
            if (!x)
                throw new AppError(
                    "Selected position is not an active lock of yours",
                    400,
                    "bad_selection",
                );
            const value = valueOfShares(pools[x.key], x.avail);
            const gross = sel.max ? value : sel.grossUsd;
            if (gross === undefined || gross <= 0n || gross > value)
                throw new AppError(
                    "Invalid locked amount",
                    400,
                    "bad_selection",
                );
            const q = quoteWithdrawal(pools, x.key, x.avail, gross, true);
            planned.push({
                lotId: x.lot.id,
                poolKey: x.key,
                shares: q.sharesBurned,
                grossUsd: q.grossUsd,
                feeUsd: q.feeUsd,
                netUsd: q.netUsd,
                early: true,
            });
            sum += gross;
        }
        if (sum !== remaining)
            throw new AppError(
                `Locked selections must total ${remaining.toString()} micro-USD (the remainder after liquid)`,
                400,
                "bad_selection",
            );
    }
    return planned;
}

async function buildQuote(tx: Tx, i: WithdrawalRequestInput) {
    const now = i.now ?? new Date();
    if (i.amountUsd < MIN_WITHDRAWAL_USD)
        throw new AppError("Minimum withdrawal is 5 USD", 400, "below_minimum");
    // Strict: a mixed-case address must match its EIP-55 checksum, so a typo in
    // a pasted checksummed address is caught (all-lowercase still passes).
    if (!isAddress(i.destinationAddress))
        throw new AppError(
            "Invalid payout address (check for typos)",
            400,
            "bad_address",
        );
    // The zero address and vault addresses would lose or strand the payout (the Factory is checked in the route).
    const dest = i.destinationAddress.toLowerCase();
    const [ownVault] = await tx
        .select({ id: vaults.id })
        .from(vaults)
        .where(eq(vaults.address, dest))
        .limit(1);
    if (/^0x0{40}$/.test(dest) || ownVault)
        throw new AppError("Payout address is not allowed", 400, "bad_address");

    const [user] = await tx
        .select()
        .from(users)
        .where(and(eq(users.id, i.userId), eq(users.isBlocked, false)))
        .limit(1);
    if (!user)
        throw new AppError("Active user not found", 404, "user_not_found");

    const [asset] = await tx
        .select()
        .from(assets)
        .where(and(eq(assets.id, i.assetId), eq(assets.isActive, true)))
        .limit(1);
    if (!asset || !STABLES.includes(asset.symbol))
        throw new AppError("Unsupported payout token", 400, "bad_asset");
    const [chain] = await tx
        .select()
        .from(chains)
        .where(eq(chains.id, asset.chainId))
        .limit(1);
    if (!chain?.isActive)
        throw new AppError("Chain is not active", 400, "bad_chain");

    const { pools, ids } = await loadPoolsForUpdate(tx);
    const planned = await planLots(tx, i, pools, ids, now);

    const sum = (f: (p: PlannedLot) => bigint) =>
        planned.reduce((s, p) => s + f(p), 0n);
    const grossUsd = sum((p) => p.grossUsd);
    const feeUsd = sum((p) => p.feeUsd);
    const netUsd = sum((p) => p.netUsd);
    return {
        now,
        asset,
        planned,
        grossUsd,
        feeUsd,
        netUsd,
        payoutAmount: usdToToken(netUsd, asset.decimals),
    };
}

// Read-only quote for the UI: affected positions, early fee, final payout.
export function previewWithdrawal(
    database: Database,
    i: WithdrawalRequestInput,
) {
    return database.transaction(async (tx) => {
        const q = await buildQuote(tx, i);
        return {
            grossUsd: q.grossUsd,
            feeUsd: q.feeUsd,
            netUsd: q.netUsd,
            payoutAmount: q.payoutAmount,
            lots: q.planned,
        };
    });
}

// User approval: reserves the shares so they cannot be relocked or requested
// twice. Uses the last settled prices (no settlement; balances don't change).
export function requestWithdrawal(
    database: Database,
    i: WithdrawalRequestInput,
) {
    return database.transaction(async (tx) => {
        const q = await buildQuote(tx, i);
        const address = i.destinationAddress.toLowerCase();

        const [w] = await tx
            .insert(withdrawals)
            .values({
                userId: i.userId,
                assetId: i.assetId,
                destinationAddress: address,
                grossAmountUsd: q.grossUsd.toString(),
                earlyFeeUsd: q.feeUsd.toString(),
                netPayoutUsd: q.netUsd.toString(),
                payoutAmount: q.payoutAmount.toString(),
                status: "pending",
                withdrawAll: i.withdrawAll ?? false,
            })
            .returning({ id: withdrawals.id });

        for (const p of q.planned) {
            await tx.insert(withdrawalAllocations).values({
                withdrawalId: w.id,
                positionLotId: p.lotId,
                shares: p.shares.toString(),
                grossAmountUsd: p.grossUsd.toString(),
                earlyFeeUsd: p.feeUsd.toString(),
                netPayoutUsd: p.netUsd.toString(),
            });
            // The CHECK (reserved <= shares) blocks any over-reservation.
            await tx
                .update(positionLots)
                .set({
                    reservedShares: sql`${positionLots.reservedShares} + ${p.shares.toString()}::numeric`,
                    updatedAt: q.now,
                })
                .where(eq(positionLots.id, p.lotId));
        }

        await tx
            .insert(payoutAddresses)
            .values({ userId: i.userId, address, lastUsedAt: q.now })
            .onConflictDoUpdate({
                target: [payoutAddresses.userId, payoutAddresses.address],
                set: { lastUsedAt: q.now },
            });

        return {
            withdrawalId: w.id as string,
            grossUsd: q.grossUsd,
            feeUsd: q.feeUsd,
            netUsd: q.netUsd,
            payoutAmount: q.payoutAmount,
        };
    });
}

async function releaseReservation(tx: Tx, withdrawalId: string) {
    const allocs = await tx
        .select()
        .from(withdrawalAllocations)
        .where(eq(withdrawalAllocations.withdrawalId, withdrawalId));
    for (const a of allocs)
        await tx
            .update(positionLots)
            .set({
                reservedShares: sql`${positionLots.reservedShares} - ${a.shares}::numeric`,
                updatedAt: new Date(),
            })
            .where(eq(positionLots.id, a.positionLotId));
}

async function requireActiveAdmin(tx: Tx, adminId: string) {
    const [adm] = await tx
        .select({ id: admins.id })
        .from(admins)
        .where(and(eq(admins.id, adminId), eq(admins.isActive, true)))
        .limit(1);
    if (!adm)
        throw new AppError("Active administrator not found", 403, "forbidden");
}

type WithdrawalRow = typeof withdrawals.$inferSelect;

// Undoes a lock (admin reject, or the user declining new terms): the user
// gets the gross back as new shares in the same lots at current prices, and
// the fee leaves the manager pool. Fund total is unchanged.
async function returnLockedFunds(
    tx: Tx,
    w: WithdrawalRow,
    adminId: string | null,
    now: Date,
) {
    const { pools, ids } = await loadPoolsForUpdate(tx);
    const keyById = new Map(
        Object.entries(ids).map(([k, id]) => [id, k as PoolKey]),
    );
    const state = clonePools(pools);
    const [last] = await tx
        .select({ id: settlements.id })
        .from(settlements)
        .orderBy(desc(settlements.settledAt))
        .limit(1);
    const allocs = await tx
        .select()
        .from(withdrawalAllocations)
        .where(eq(withdrawalAllocations.withdrawalId, w.id));
    const lines: LedgerLine[] = [];
    let fee = 0n,
        net = 0n;
    for (const a of allocs) {
        const gross = BigInt(a.grossAmountUsd);
        if (gross === 0n) continue;
        const [lot] = await tx
            .select()
            .from(positionLots)
            .where(eq(positionLots.id, a.positionLotId))
            .for("update");
        const key = keyById.get(lot.poolId)!;
        const m = mint(state[key], gross);
        state[key] = m.state;
        fee += BigInt(a.earlyFeeUsd);
        net += BigInt(a.netPayoutUsd);
        // shortcut: principal grows by the returned gross (not the exact
        // amount removed at lock), so displayed yield on it restarts; fine for
        // a rare undo, store the removed principal if it matters.
        await tx
            .update(positionLots)
            .set({
                shares: sql`${positionLots.shares} + ${m.shares.toString()}::numeric`,
                principalUsd: sql`${positionLots.principalUsd} + ${gross.toString()}::numeric`,
                closedAt: null,
                updatedAt: now,
            })
            .where(eq(positionLots.id, lot.id));
        lines.push({
            account: "pool_equity",
            poolId: ids[key],
            userId: lot.userId,
            direction: "credit",
            amountUsd: gross,
        });
        if (last)
            await recordFlow(tx, {
                userId: lot.userId,
                settlementId: last.id,
                kind: "withdrawal",
                amountUsd: gross,
            });
    }
    state.manager.assets -= fee;
    if (fee > 0n)
        lines.push({
            account: "pool_equity",
            poolId: ids.manager,
            direction: "debit",
            amountUsd: fee,
        });
    if (net > 0n)
        lines.push({
            account: "managed_funds",
            direction: "debit",
            amountUsd: net,
        });
    if (lines.length)
        await postLedger(tx, {
            type: "withdrawal_reversal",
            referenceType: "withdrawal",
            referenceId: w.id,
            adminId,
            lines,
        });
    await savePools(tx, ids, state);
}

// User cancels while pending and not locked, or declines the new terms of a
// lock that is waiting for them (the locked funds go back to their lots).
export function cancelWithdrawal(
    database: Database,
    i: { withdrawalId: string; userId: string; now?: Date },
) {
    return database.transaction(async (tx) => {
        const [w] = await tx
            .select()
            .from(withdrawals)
            .where(
                and(
                    eq(withdrawals.id, i.withdrawalId),
                    eq(withdrawals.userId, i.userId),
                ),
            )
            .for("update");
        if (!w) throw new AppError("Withdrawal not found", 404, "not_found");
        if (w.status !== "pending")
            throw new AppError(
                "Only a pending withdrawal can be cancelled",
                409,
                "bad_state",
            );
        if (w.lockedAt && !w.awaitingUserAt)
            throw new AppError(
                "The payout is being processed and can no longer be cancelled",
                409,
                "locked",
            );
        const now = i.now ?? new Date();
        if (w.lockedAt) await returnLockedFunds(tx, w, null, now);
        else await releaseReservation(tx, w.id);
        await tx
            .update(withdrawals)
            .set({ status: "cancelled", awaitingUserAt: null, updatedAt: now })
            .where(eq(withdrawals.id, w.id));
    });
}

// User accepts the new terms of a lock that is waiting for them.
export function confirmWithdrawal(
    database: Database,
    i: { withdrawalId: string; userId: string },
) {
    return database.transaction(async (tx) => {
        const [w] = await tx
            .select()
            .from(withdrawals)
            .where(
                and(
                    eq(withdrawals.id, i.withdrawalId),
                    eq(withdrawals.userId, i.userId),
                ),
            )
            .for("update");
        if (!w) throw new AppError("Withdrawal not found", 404, "not_found");
        if (w.status !== "pending" || !w.awaitingUserAt)
            throw new AppError(
                "Nothing to confirm for this withdrawal",
                409,
                "bad_state",
            );
        await tx
            .update(withdrawals)
            .set({ awaitingUserAt: null, updatedAt: new Date() })
            .where(eq(withdrawals.id, w.id));
    });
}

// Admin locks before sending anything. Settles first (operator-entered total
// NAV), then fixes the final amounts at the new prices (lockWithdrawalLot):
// the shares leave the pools now and the fee goes to the manager pool, so the
// recorded payout is exactly what the admin sends. A payout more than 1% below
// the asked amount waits for the user to confirm. Mark paid then only records
// the transaction.
export function lockWithdrawal(
    database: Database,
    i: {
        withdrawalId: string;
        adminId: string;
        reportedTotalUsd: bigint;
        confirmLargeMove?: boolean;
        now?: Date;
    },
) {
    return database.transaction(async (tx) => {
        await requireActiveAdmin(tx, i.adminId);
        const [w] = await tx
            .select()
            .from(withdrawals)
            .where(eq(withdrawals.id, i.withdrawalId))
            .for("update");
        if (!w) throw new AppError("Withdrawal not found", 404, "not_found");
        if (w.status !== "pending")
            throw new AppError("Withdrawal is not pending", 409, "bad_state");
        if (w.lockedAt)
            throw new AppError("Withdrawal is already locked", 409, "locked");
        const [asset] = await tx
            .select()
            .from(assets)
            .where(eq(assets.id, w.assetId))
            .limit(1);

        const settled = await settleInTx(tx, {
            adminId: i.adminId,
            reportedTotalUsd: i.reportedTotalUsd,
            kind: "pre_action",
            note: `withdrawal ${w.id}`,
            confirmLargeMove: i.confirmLargeMove,
            now: i.now,
        });
        const now = settled.now;
        const keyById = new Map(
            Object.entries(settled.ids).map(([k, id]) => [id, k as PoolKey]),
        );
        const state = clonePools(settled.pools);

        const allocs = await tx
            .select()
            .from(withdrawalAllocations)
            .where(eq(withdrawalAllocations.withdrawalId, w.id));
        const lots = new Map<string, typeof positionLots.$inferSelect>();
        for (const a of allocs) {
            const [lot] = await tx
                .select()
                .from(positionLots)
                .where(eq(positionLots.id, a.positionLotId))
                .for("update");
            lots.set(a.id, lot);
        }
        let asked = 0n,
            usedMoreShares = false;
        let gross = 0n,
            fee = 0n,
            net = 0n,
            managerCredit = 0n;
        const lines: LedgerLine[] = [];
        for (const a of allocs) {
            const lot = lots.get(a.id)!;
            const key = keyById.get(lot.poolId)!;
            const reserved = BigInt(a.shares);
            const f = lockWithdrawalLot(
                state[key],
                reserved,
                BigInt(lot.shares) - BigInt(lot.reservedShares),
                BigInt(a.grossAmountUsd),
                BigInt(a.earlyFeeUsd) > 0n, // early iff a fee was quoted
                w.withdrawAll,
            );
            asked += BigInt(a.grossAmountUsd);
            if (f.burnShares > reserved) usedMoreShares = true;
            const burned = burn(state[key], f.burnShares);
            state[key] = burned.state;
            const toManager = burned.usd - f.netUsd; // fee + rounding dust
            state.manager.assets += toManager;

            gross += f.grossUsd;
            fee += f.feeUsd;
            net += f.netUsd;
            managerCredit += toManager;
            lines.push({
                account: "pool_equity",
                poolId: settled.ids[key],
                userId: lot.userId,
                direction: "debit",
                amountUsd: burned.usd,
            });
            if (key !== "manager")
                await recordFlow(tx, {
                    userId: lot.userId,
                    settlementId: settled.settlementId,
                    kind: "withdrawal",
                    amountUsd: -burned.usd,
                });

            const newShares = BigInt(lot.shares) - f.burnShares;
            // Principal leaves with the shares, same as a relock (keeps yield = value - principal).
            const carried =
                (BigInt(lot.principalUsd) * f.burnShares) / BigInt(lot.shares);
            await tx
                .update(positionLots)
                .set({
                    principalUsd: (
                        BigInt(lot.principalUsd) - carried
                    ).toString(),
                    shares: newShares.toString(),
                    reservedShares: (
                        BigInt(lot.reservedShares) - reserved
                    ).toString(),
                    closedAt: newShares === 0n ? now : null,
                    updatedAt: now,
                })
                .where(eq(positionLots.id, lot.id));
            await tx
                .update(withdrawalAllocations)
                .set({
                    shares: f.burnShares.toString(),
                    grossAmountUsd: f.grossUsd.toString(),
                    earlyFeeUsd: f.feeUsd.toString(),
                    netPayoutUsd: f.netUsd.toString(),
                })
                .where(eq(withdrawalAllocations.id, a.id));
        }

        lines.push({
            account: "managed_funds",
            direction: "credit",
            amountUsd: net,
        });
        lines.push({
            account: "pool_equity",
            poolId: settled.ids.manager,
            direction: "credit",
            amountUsd: managerCredit,
        });
        await postLedger(tx, {
            type: "withdrawal",
            referenceType: "withdrawal",
            referenceId: w.id,
            adminId: i.adminId,
            lines,
        });
        await savePools(tx, settled.ids, state);
        // Ask only when the payout itself falls more than 1% short of what was
        // asked (too few free shares); a loss covered by them is just applied.
        const awaitingUser = needsConfirmation(asked, gross);

        await tx
            .update(withdrawals)
            .set({
                grossAmountUsd: gross.toString(),
                earlyFeeUsd: fee.toString(),
                netPayoutUsd: net.toString(),
                payoutAmount: usdToToken(net, asset.decimals).toString(),
                lockedAt: now,
                awaitingUserAt: awaitingUser ? now : null,
                reviewedByAdminId: i.adminId,
                reviewedAt: now,
                updatedAt: now,
            })
            .where(eq(withdrawals.id, w.id));
        await tx.insert(auditLogs).values({
            adminId: i.adminId,
            action: "withdrawal.locked",
            entityType: "withdrawal",
            entityId: w.id,
            details: {
                grossUsd: gross.toString(),
                feeUsd: fee.toString(),
                netUsd: net.toString(),
                quotedNetUsd: w.netPayoutUsd,
                awaitingUser,
                settlementId: settled.settlementId,
            },
        });
        return {
            userId: w.userId,
            grossUsd: gross,
            feeUsd: fee,
            netUsd: net,
            quotedNetUsd: BigInt(w.netPayoutUsd),
            awaitingUser,
            usedMoreShares,
            settlementId: settled.settlementId,
        };
    });
}

// Admin rejects with a user-visible reason. A locked withdrawal's funds go
// back to the user's lots.
export function rejectWithdrawal(
    database: Database,
    i: { withdrawalId: string; adminId: string; reason: string; now?: Date },
) {
    return database.transaction(async (tx) => {
        if (!i.reason.trim())
            throw new AppError("A reason is required", 400, "bad_reason");
        await requireActiveAdmin(tx, i.adminId);
        const [w] = await tx
            .select()
            .from(withdrawals)
            .where(eq(withdrawals.id, i.withdrawalId))
            .for("update");
        if (!w) throw new AppError("Withdrawal not found", 404, "not_found");
        if (w.status !== "pending")
            throw new AppError("Withdrawal is not pending", 409, "bad_state");
        const now = i.now ?? new Date();
        if (w.lockedAt) await returnLockedFunds(tx, w, i.adminId, now);
        else await releaseReservation(tx, w.id);
        await tx
            .update(withdrawals)
            .set({
                status: "rejected",
                awaitingUserAt: null,
                rejectionReason: i.reason,
                reviewedByAdminId: i.adminId,
                reviewedAt: now,
                updatedAt: now,
            })
            .where(eq(withdrawals.id, w.id));
        await tx.insert(auditLogs).values({
            adminId: i.adminId,
            action: "withdrawal.rejected",
            entityType: "withdrawal",
            entityId: w.id,
            details: { reason: i.reason },
        });
    });
}

// Admin records the outgoing transaction of the amount fixed at lock. Never
// changes amounts.
export function markWithdrawalPaid(
    database: Database,
    i: { withdrawalId: string; adminId: string; txHash: string; now?: Date },
) {
    return database.transaction(async (tx) => {
        if (!TX_HASH.test(i.txHash))
            throw new AppError("Invalid transaction hash", 400, "bad_tx");
        await requireActiveAdmin(tx, i.adminId);
        const [w] = await tx
            .select()
            .from(withdrawals)
            .where(eq(withdrawals.id, i.withdrawalId))
            .for("update");
        if (!w) throw new AppError("Withdrawal not found", 404, "not_found");
        if (w.status !== "pending")
            throw new AppError("Withdrawal is not pending", 409, "bad_state");
        if (!w.lockedAt)
            throw new AppError(
                "Lock the withdrawal before marking it paid",
                409,
                "not_locked",
            );
        if (w.awaitingUserAt)
            throw new AppError(
                "The user has not confirmed the new terms yet",
                409,
                "awaiting_user",
            );
        const now = i.now ?? new Date();
        await tx
            .update(withdrawals)
            .set({
                status: "paid",
                txHash: i.txHash.toLowerCase(),
                processedByAdminId: i.adminId,
                processedAt: now,
                updatedAt: now,
            })
            .where(eq(withdrawals.id, w.id));
        await tx.insert(auditLogs).values({
            adminId: i.adminId,
            action: "withdrawal.paid",
            entityType: "withdrawal",
            entityId: w.id,
            details: { txHash: i.txHash.toLowerCase(), netUsd: w.netPayoutUsd },
        });
        return {
            grossUsd: BigInt(w.grossAmountUsd),
            feeUsd: BigInt(w.earlyFeeUsd),
            netUsd: BigInt(w.netPayoutUsd),
        };
    });
}
