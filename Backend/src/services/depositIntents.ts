import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import {
    admins,
    assets,
    auditLogs,
    chains,
    depositIntentAllocations,
    depositIntents,
    depositTransfers,
    deposits,
    pools,
    positionLots,
    users,
    vaults,
} from "../db/schema.js";
import { USD_MICRO } from "../accounting/fixed.js";
import { applyDeposit, splitByBps } from "../accounting/actions.js";
import {
    LOCK_MONTHS,
    STABLES,
    TX_HASH,
    clonePools,
    type PoolKey,
} from "../accounting/pools.js";
import { AppError } from "../errors.js";
import { postLedger, type LedgerLine } from "./ledger.js";
import { loadPoolsForUpdate, savePools } from "./poolStore.js";
import { settleInTx } from "./settlement.js";
import { addMonths } from "./time.js";
import type { Database, Tx } from "./types.js";
import { recordFlow } from "./history.js";

export const MIN_DEPOSIT_USD = 50n * USD_MICRO;
// A deposit that goes only to the manager pool (admin bootstrap) needs 1 USD.
export const MIN_MANAGER_DEPOSIT_USD = 1n * USD_MICRO;
export const INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const OPEN_FOR_MATCH = ["intent", "transfer_detected"];

// 1 stablecoin = 1 USD for now. Floor.
export const tokenToUsd = (amount: bigint, decimals: number): bigint =>
    (amount * USD_MICRO) / 10n ** BigInt(decimals);

/* ---------------------------- intents ---------------------------- */
export interface CreateIntentInput {
    userId: string;
    vaultId: string;
    assetId: string;
    intendedAmount: bigint; // token units
    allocations: { poolKey: PoolKey; bps: number }[]; // sums to 10000
    now?: Date;
}

export function createIntent(database: Database, i: CreateIntentInput) {
    return database.transaction(async (tx) => {
        const now = i.now ?? new Date();
        const [user] = await tx
            .select()
            .from(users)
            .where(and(eq(users.id, i.userId), eq(users.isBlocked, false)))
            .limit(1);
        if (!user)
            throw new AppError("Active user not found", 404, "user_not_found");

        const [vault] = await tx
            .select()
            .from(vaults)
            .where(
                and(
                    eq(vaults.id, i.vaultId),
                    eq(vaults.userId, i.userId),
                    eq(vaults.isActive, true),
                ),
            )
            .limit(1);
        if (!vault)
            throw new AppError(
                "Active vault not found for this user",
                404,
                "vault_not_found",
            );

        const [asset] = await tx
            .select()
            .from(assets)
            .where(and(eq(assets.id, i.assetId), eq(assets.isActive, true)))
            .limit(1);
        if (!asset || asset.chainId !== vault.chainId)
            throw new AppError(
                "Asset is not supported on this vault's chain",
                400,
                "bad_asset",
            );
        if (!STABLES.includes(asset.symbol))
            throw new AppError("Unsupported stablecoin", 400, "bad_asset");
        const [chain] = await tx
            .select()
            .from(chains)
            .where(eq(chains.id, asset.chainId))
            .limit(1);
        if (!chain?.isActive)
            throw new AppError("Chain is not active", 400, "bad_chain");

        if (i.intendedAmount <= 0n)
            throw new AppError("Amount must be positive", 400, "bad_amount");
        // Non-admins sending to manager are rejected below with 403.
        const managerOnly =
            i.allocations.length === 1 &&
            i.allocations[0].poolKey === "manager";
        if (
            tokenToUsd(i.intendedAmount, asset.decimals) <
            (managerOnly ? MIN_MANAGER_DEPOSIT_USD : MIN_DEPOSIT_USD)
        )
            throw new AppError(
                `Minimum deposit is ${managerOnly ? 1 : 50} USD`,
                400,
                "below_minimum",
            );

        if (
            i.allocations.reduce((s, a) => s + a.bps, 0) !== 10_000 ||
            i.allocations.some((a) => !Number.isInteger(a.bps) || a.bps <= 0) ||
            new Set(i.allocations.map((a) => a.poolKey)).size !==
                i.allocations.length
        )
            throw new AppError(
                "Allocations must be unique and sum to 10000 bps",
                400,
                "bad_allocation",
            );

        const { ids } = await loadPoolsForUpdate(tx);
        if (i.allocations.some((a) => a.poolKey === "manager")) {
            const [adm] = await tx
                .select({ id: admins.id })
                .from(admins)
                .where(
                    and(
                        eq(admins.telegramId, user.telegramId),
                        eq(admins.isActive, true),
                    ),
                )
                .limit(1);
            if (!adm)
                throw new AppError(
                    "Only the manager can deposit into the manager pool",
                    403,
                    "forbidden",
                );
        }

        const [intent] = await tx
            .insert(depositIntents)
            .values({
                userId: i.userId,
                vaultId: i.vaultId,
                assetId: asset.id,
                chainId: asset.chainId,
                tokenAddress: asset.tokenAddress,
                intendedAmount: i.intendedAmount.toString(),
                status: "intent",
                expiresAt: new Date(now.getTime() + INTENT_TTL_MS),
            })
            .returning();
        await tx.insert(depositIntentAllocations).values(
            i.allocations.map((a) => ({
                intentId: intent.id,
                poolId: ids[a.poolKey],
                shareBps: a.bps,
            })),
        );
        return intent;
    });
}

export function expireStaleIntents(database: Database, now = new Date()) {
    return database
        .update(depositIntents)
        .set({ status: "expired", updatedAt: now })
        .where(
            and(
                eq(depositIntents.status, "intent"),
                lt(depositIntents.expiresAt, now),
            ),
        )
        .returning({ id: depositIntents.id });
}

export async function cancelIntent(
    database: Database,
    intentId: string,
    userId: string,
) {
    const r = await database
        .update(depositIntents)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
            and(
                eq(depositIntents.id, intentId),
                eq(depositIntents.userId, userId),
                eq(depositIntents.status, "intent"),
            ),
        )
        .returning({ id: depositIntents.id });
    if (!r.length)
        throw new AppError(
            "Intent not found or can no longer be cancelled",
            409,
            "bad_state",
        );
}

async function attach(tx: Tx, transferId: string, intentId: string, now: Date) {
    const [t] = await tx
        .select()
        .from(depositTransfers)
        .where(eq(depositTransfers.id, transferId))
        .for("update");
    const [intent] = await tx
        .select()
        .from(depositIntents)
        .where(eq(depositIntents.id, intentId))
        .for("update");
    if (!t || !intent)
        throw new AppError("Transfer or intent not found", 404, "not_found");
    if (t.intentId || t.status !== "detected")
        throw new AppError("Transfer already matched", 409, "bad_state");
    if (t.vaultId !== intent.vaultId || t.assetId !== intent.assetId)
        throw new AppError(
            "Transfer does not match the intent's vault and token",
            400,
            "mismatch",
        );
    if (
        !OPEN_FOR_MATCH.includes(intent.status) ||
        (intent.status === "intent" && intent.expiresAt < now)
    )
        throw new AppError("Intent is not open for matching", 409, "bad_state");
    await tx
        .update(depositTransfers)
        .set({ intentId, status: "pending_review" })
        .where(eq(depositTransfers.id, transferId));
    await tx
        .update(depositIntents)
        .set({ status: "transfer_detected", updatedAt: now })
        .where(eq(depositIntents.id, intentId));
}

export function matchTransfer(
    database: Database,
    transferId: string,
    intentId: string,
    now = new Date(),
) {
    return database.transaction((tx) => attach(tx, transferId, intentId, now));
}

// Attach automatically only when exactly one open intent fits. Else manual.
export function autoMatchTransfer(
    database: Database,
    transferId: string,
    now = new Date(),
) {
    return database.transaction(async (tx) => {
        const [t] = await tx
            .select()
            .from(depositTransfers)
            .where(eq(depositTransfers.id, transferId))
            .limit(1);
        if (!t || t.intentId) return { matched: false as const };
        const cands = await tx
            .select()
            .from(depositIntents)
            .where(
                and(
                    eq(depositIntents.vaultId, t.vaultId),
                    eq(depositIntents.assetId, t.assetId),
                    // Only fresh requests: a request that already has a transfer
                    // must not take a stranger's small transfer automatically.
                    eq(depositIntents.status, "intent"),
                ),
            );
        const open = cands.filter((c) => c.expiresAt >= now);
        if (open.length !== 1) return { matched: false as const };
        await attach(tx, transferId, open[0].id, now);
        return { matched: true as const, intentId: open[0].id };
    });
}

/* ------------------- sweep, approval, activation ------------------ */
// Operator records the confirmed swept amount (token units).
export function recordSweep(
    database: Database,
    i: {
        intentId: string;
        adminId: string;
        sweepTxHash: string;
        confirmedAmount?: bigint;
        // From verifySweepTx; null/undefined = not verified (test env only).
        sweptAmount?: bigint | null;
        now?: Date;
    },
) {
    return database.transaction(async (tx) => {
        const now = i.now ?? new Date();
        if (!TX_HASH.test(i.sweepTxHash))
            throw new AppError("Invalid transaction hash", 400, "bad_tx");
        const [intent] = await tx
            .select()
            .from(depositIntents)
            .where(eq(depositIntents.id, i.intentId))
            .for("update");
        if (!intent) throw new AppError("Intent not found", 404, "not_found");
        if (intent.status !== "transfer_detected")
            throw new AppError(
                "Intent has no matched transfer awaiting sweep",
                409,
                "bad_state",
            );

        const [vault] = await tx
            .select()
            .from(vaults)
            .where(eq(vaults.id, intent.vaultId))
            .limit(1);
        if (!vault?.isDeployed)
            throw new AppError(
                "Deploy the vault before sweeping",
                409,
                "vault_not_deployed",
            );
        const [asset] = await tx
            .select()
            .from(assets)
            .where(eq(assets.id, intent.assetId))
            .limit(1);

        const [sum] = await tx
            .select({
                total: sql<string>`coalesce(sum(${depositTransfers.amount}), 0)`,
            })
            .from(depositTransfers)
            .where(eq(depositTransfers.intentId, intent.id));
        const confirmed = i.confirmedAmount ?? BigInt(sum.total);
        if (confirmed <= 0n)
            throw new AppError(
                "Confirmed amount must be positive",
                400,
                "bad_amount",
            );
        // One sweep may cover several deposits in the vault, but the amounts
        // recorded against it may never exceed what it moved.
        if (i.sweptAmount != null) {
            const [used] = await tx
                .select({
                    total: sql<string>`coalesce(sum(${depositIntents.confirmedAmount}), 0)`,
                })
                .from(depositIntents)
                .where(
                    and(
                        eq(depositIntents.chainId, intent.chainId),
                        eq(
                            depositIntents.sweepTxHash,
                            i.sweepTxHash.toLowerCase(),
                        ),
                        ne(depositIntents.status, "rejected"),
                        ne(depositIntents.id, intent.id),
                    ),
                );
            if (BigInt(used.total) + confirmed > i.sweptAmount)
                throw new AppError(
                    "Confirmed amount exceeds what the sweep transaction moved",
                    400,
                    "sweep_amount_mismatch",
                );
        }
        const confirmedUsd = tokenToUsd(confirmed, asset.decimals);
        const intentPools = await tx
            .select({ isManager: pools.isManager })
            .from(depositIntentAllocations)
            .innerJoin(pools, eq(pools.id, depositIntentAllocations.poolId))
            .where(eq(depositIntentAllocations.intentId, intent.id));
        const managerOnly =
            intentPools.length === 1 && intentPools[0].isManager;
        if (
            confirmedUsd <
            (managerOnly ? MIN_MANAGER_DEPOSIT_USD : MIN_DEPOSIT_USD)
        )
            throw new AppError(
                `Confirmed amount is below the ${managerOnly ? 1 : 50} USD minimum`,
                400,
                "below_minimum",
            );

        const matches = confirmed === BigInt(intent.intendedAmount);
        const status = matches ? "ready_to_activate" : "awaiting_user_approval";
        await tx
            .update(depositIntents)
            .set({
                confirmedAmount: confirmed.toString(),
                confirmedAmountUsd: confirmedUsd.toString(),
                sweepTxHash: i.sweepTxHash.toLowerCase(),
                sweptByAdminId: i.adminId,
                sweptAt: now,
                status,
                updatedAt: now,
            })
            .where(eq(depositIntents.id, intent.id));
        await tx.insert(auditLogs).values({
            adminId: i.adminId,
            action: "deposit.sweep_recorded",
            entityType: "deposit_intent",
            entityId: intent.id,
            details: {
                confirmedAmount: confirmed.toString(),
                intended: intent.intendedAmount,
                sweepTxHash: i.sweepTxHash.toLowerCase(),
                status,
            },
        });
        return { status, confirmedAmountUsd: confirmedUsd };
    });
}

// User approves a confirmed amount that differs from the intent.
export function approveAmount(
    database: Database,
    i: { intentId: string; userId: string; now?: Date },
) {
    return database.transaction(async (tx) => {
        const now = i.now ?? new Date();
        const [intent] = await tx
            .select()
            .from(depositIntents)
            .where(
                and(
                    eq(depositIntents.id, i.intentId),
                    eq(depositIntents.userId, i.userId),
                ),
            )
            .for("update");
        if (!intent) throw new AppError("Intent not found", 404, "not_found");
        if (intent.status !== "awaiting_user_approval")
            throw new AppError("Nothing to approve", 409, "bad_state");
        await tx
            .update(depositIntents)
            .set({
                status: "ready_to_activate",
                userApprovedAmountAt: now,
                updatedAt: now,
            })
            .where(eq(depositIntents.id, intent.id));
    });
}

export function rejectIntent(
    database: Database,
    i: { intentId: string; adminId: string; reason: string },
) {
    return database.transaction(async (tx) => {
        if (!i.reason.trim())
            throw new AppError("A reason is required", 400, "bad_reason");
        const [intent] = await tx
            .select()
            .from(depositIntents)
            .where(eq(depositIntents.id, i.intentId))
            .for("update");
        if (!intent) throw new AppError("Intent not found", 404, "not_found");
        if (
            ![
                "transfer_detected",
                "awaiting_user_approval",
                "ready_to_activate",
            ].includes(intent.status)
        )
            throw new AppError(
                "Intent cannot be rejected in this state",
                409,
                "bad_state",
            );
        await tx
            .update(depositIntents)
            .set({
                status: "rejected",
                rejectionReason: i.reason,
                updatedAt: new Date(),
            })
            .where(eq(depositIntents.id, intent.id));
        await tx
            .update(depositTransfers)
            .set({ status: "rejected" })
            .where(eq(depositTransfers.intentId, intent.id));
        await tx.insert(auditLogs).values({
            adminId: i.adminId,
            action: "deposit.rejected",
            entityType: "deposit_intent",
            entityId: intent.id,
            details: { reason: i.reason },
        });
    });
}

// Settles first (operator-entered current total NAV), then mints shares and
// creates one lot per tier split. Earning and lock start now.
export function activateDeposit(
    database: Database,
    i: {
        intentId: string;
        adminId: string;
        reportedTotalUsd: bigint;
        confirmLargeMove?: boolean;
        now?: Date;
    },
) {
    return database.transaction(async (tx) => {
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

        const [intent] = await tx
            .select()
            .from(depositIntents)
            .where(eq(depositIntents.id, i.intentId))
            .for("update");
        if (!intent) throw new AppError("Intent not found", 404, "not_found");
        if (intent.status !== "ready_to_activate")
            throw new AppError(
                "Intent is not ready to activate",
                409,
                "bad_state",
            );

        const settled = await settleInTx(tx, {
            adminId: i.adminId,
            reportedTotalUsd: i.reportedTotalUsd,
            kind: "pre_action",
            note: `deposit ${intent.id}`,
            confirmLargeMove: i.confirmLargeMove,
            now: i.now,
        });
        const now = settled.now;

        const allocs = await tx
            .select()
            .from(depositIntentAllocations)
            .where(eq(depositIntentAllocations.intentId, intent.id));
        const keyById = new Map(
            Object.entries(settled.ids).map(([k, id]) => [id, k as PoolKey]),
        );
        const usd = BigInt(intent.confirmedAmountUsd!);
        const split = splitByBps(
            usd,
            allocs
                .map((a) => ({
                    poolKey: keyById.get(a.poolId)!,
                    bps: a.shareBps,
                }))
                .sort((a, b) => a.poolKey.localeCompare(b.poolKey)),
        );

        let state = clonePools(settled.pools);
        const [dep] = await tx
            .insert(deposits)
            .values({
                intentId: intent.id,
                userId: intent.userId,
                amount: intent.confirmedAmount!,
                amountUsd: usd.toString(),
                sweepTxHash: intent.sweepTxHash!,
                settlementId: settled.settlementId,
                confirmedByAdminId: i.adminId,
                confirmedAt: now,
            })
            .returning({ id: deposits.id });

        const lines: LedgerLine[] = [];
        for (const part of split) {
            if (part.usd === 0n) continue;
            const r = applyDeposit(state, part.poolKey, part.usd);
            state = r.pools;
            await tx.insert(positionLots).values({
                userId: intent.userId,
                poolId: settled.ids[part.poolKey],
                shares: r.shares.toString(),
                principalUsd: part.usd.toString(),
                openedAt: now,
                maturesAt: LOCK_MONTHS[part.poolKey]
                    ? addMonths(now, LOCK_MONTHS[part.poolKey])
                    : null,
                sourceType: "deposit",
                sourceId: dep.id,
            });
            lines.push({
                account: "pool_equity",
                poolId: settled.ids[part.poolKey],
                userId: intent.userId,
                direction: "credit",
                amountUsd: part.usd,
            });
            if (part.poolKey !== "manager")
                await recordFlow(tx, {
                    userId: intent.userId,
                    settlementId: settled.settlementId,
                    kind: "deposit",
                    amountUsd: part.usd,
                });
        }
        lines.push({
            account: "managed_funds",
            direction: "debit",
            amountUsd: usd,
        });
        await postLedger(tx, {
            type: "deposit",
            referenceType: "deposit",
            referenceId: dep.id,
            adminId: i.adminId,
            lines,
        });
        await savePools(tx, settled.ids, state);

        await tx
            .update(depositTransfers)
            .set({ status: "swept_and_confirmed" })
            .where(eq(depositTransfers.intentId, intent.id));
        await tx
            .update(depositIntents)
            .set({ status: "swept_and_confirmed", updatedAt: now })
            .where(eq(depositIntents.id, intent.id));
        await tx.insert(auditLogs).values({
            adminId: i.adminId,
            action: "deposit.activated",
            entityType: "deposit",
            entityId: dep.id,
            details: {
                intentId: intent.id,
                userId: intent.userId,
                amountUsd: usd.toString(),
                split: split.map((s) => ({
                    pool: s.poolKey,
                    usd: s.usd.toString(),
                })),
                settlementId: settled.settlementId,
            },
        });
        return {
            depositId: dep.id,
            amountUsd: usd,
            settlementId: settled.settlementId,
        };
    });
}
