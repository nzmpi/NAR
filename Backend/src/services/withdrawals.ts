import { and, eq, isNull, sql } from "drizzle-orm";
import {
    admins,
    assets,
    auditLogs,
    chains,
    payoutAddresses,
    positionLots,
    users,
    withdrawalAllocations,
    withdrawals,
} from "../db/schema.js";
import { USD_MICRO } from "../accounting/fixed.js";
import { quoteWithdrawal } from "../accounting/actions.js";
import { finalizeWithdrawalLot } from "../accounting/withdraw.js";
import {
    LOCK_KEYS,
    burn,
    clonePools,
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

export const MIN_WITHDRAWAL_USD = 5n * USD_MICRO;
const STABLES = ["USDT", "USDC", "DAI"];
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH = /^0x[a-fA-F0-9]{64}$/;

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
    if (!EVM_ADDRESS.test(i.destinationAddress))
        throw new AppError("Invalid payout address", 400, "bad_address");

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

// User can cancel only while pending.
export function cancelWithdrawal(
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
        if (w.status !== "pending")
            throw new AppError(
                "Only a pending withdrawal can be cancelled",
                409,
                "bad_state",
            );
        await releaseReservation(tx, w.id);
        await tx
            .update(withdrawals)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(eq(withdrawals.id, w.id));
    });
}

// Admin rejects with a user-visible reason.
export function rejectWithdrawal(
    database: Database,
    i: { withdrawalId: string; adminId: string; reason: string },
) {
    return database.transaction(async (tx) => {
        if (!i.reason.trim())
            throw new AppError("A reason is required", 400, "bad_reason");
        const [adm] = await tx
            .select({ id: admins.id })
            .from(admins)
            .where(and(eq(admins.id, i.adminId), eq(admins.isActive, true)))
            .limit(1);
        if (!adm)
            throw new AppError(
                "Active administrator not found",
                403,
                "forbidden",
            );
        const [w] = await tx
            .select()
            .from(withdrawals)
            .where(eq(withdrawals.id, i.withdrawalId))
            .for("update");
        if (!w) throw new AppError("Withdrawal not found", 404, "not_found");
        if (w.status !== "pending")
            throw new AppError("Withdrawal is not pending", 409, "bad_state");
        const now = new Date();
        await releaseReservation(tx, w.id);
        await tx
            .update(withdrawals)
            .set({
                status: "rejected",
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

// Admin records the outgoing transaction. Settles first (operator-entered
// total NAV, counting this withdrawal's funds as still managed), then burns
// the reserved shares, credits the fee to the manager pool and marks paid.
export function markWithdrawalPaid(
    database: Database,
    i: {
        withdrawalId: string;
        adminId: string;
        txHash: string;
        reportedTotalUsd: bigint;
        now?: Date;
    },
) {
    return database.transaction(async (tx) => {
        if (!TX_HASH.test(i.txHash))
            throw new AppError("Invalid transaction hash", 400, "bad_tx");
        const [adm] = await tx
            .select({ id: admins.id })
            .from(admins)
            .where(and(eq(admins.id, i.adminId), eq(admins.isActive, true)))
            .limit(1);
        if (!adm)
            throw new AppError(
                "Active administrator not found",
                403,
                "forbidden",
            );

        const [w] = await tx
            .select()
            .from(withdrawals)
            .where(eq(withdrawals.id, i.withdrawalId))
            .for("update");
        if (!w) throw new AppError("Withdrawal not found", 404, "not_found");
        if (w.status !== "pending")
            throw new AppError("Withdrawal is not pending", 409, "bad_state");
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
            now: i.now,
        });
        const now = settled.now;
        const keyById = new Map(
            Object.entries(settled.ids).map(([k, id]) => [id, k as PoolKey]),
        );
        let state = clonePools(settled.pools);

        const allocs = await tx
            .select()
            .from(withdrawalAllocations)
            .where(eq(withdrawalAllocations.withdrawalId, w.id));

        let gross = 0n,
            fee = 0n,
            net = 0n,
            managerCredit = 0n;
        const lines: LedgerLine[] = [];
        for (const a of allocs) {
            const [lot] = await tx
                .select()
                .from(positionLots)
                .where(eq(positionLots.id, a.positionLotId))
                .for("update");
            const key = keyById.get(lot.poolId)!;
            // Fee was fixed at approval: early if the lot was still locked then.
            const early =
                LOCK_KEYS.includes(key as LockKey) &&
                lot.maturesAt !== null &&
                lot.maturesAt.getTime() > w.createdAt.getTime();

            const f = finalizeWithdrawalLot(
                state[key],
                BigInt(a.shares),
                BigInt(a.grossAmountUsd),
                early,
            );
            const burned = burn(state[key], f.burnShares);
            state[key] = burned.state;
            const toManager = burned.usd - f.netUsd; // fee + rounding dust
            state.manager.assets += toManager;
            if (toManager > 0n && state.manager.shares === 0n)
                throw new AppError(
                    "Manager pool has no shares to receive the fee",
                    409,
                    "no_manager_pool",
                );

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

            const newShares = BigInt(lot.shares) - f.burnShares;
            await tx
                .update(positionLots)
                .set({
                    shares: newShares.toString(),
                    reservedShares: (
                        BigInt(lot.reservedShares) - BigInt(a.shares)
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

        await tx
            .update(withdrawals)
            .set({
                grossAmountUsd: gross.toString(),
                earlyFeeUsd: fee.toString(),
                netPayoutUsd: net.toString(),
                payoutAmount: usdToToken(net, asset.decimals).toString(),
                status: "paid",
                txHash: i.txHash.toLowerCase(),
                reviewedByAdminId: i.adminId,
                reviewedAt: now,
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
            details: {
                txHash: i.txHash.toLowerCase(),
                grossUsd: gross.toString(),
                feeUsd: fee.toString(),
                netUsd: net.toString(),
                quotedNetUsd: w.netPayoutUsd,
                settlementId: settled.settlementId,
            },
        });
        return {
            grossUsd: gross,
            feeUsd: fee,
            netUsd: net,
            settlementId: settled.settlementId,
        };
    });
}
