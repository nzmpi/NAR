import {
    pgTable,
    uuid,
    text,
    boolean,
    timestamp,
    integer,
    numeric,
    jsonb,
    uniqueIndex,
    index,
    check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Conventions
// - USD values: integer micro-dollars (1 USD = 1_000_000), stored as numeric(78,0).
// - Shares: 18-decimal fixed point, stored as numeric(78,0).
// - Token amounts: token smallest units, numeric(78,0).
// - Never convert these to JS numbers; use bigint.
const bigAmount = (name: string) => numeric(name, { precision: 78, scale: 0 });
const createdAt = () =>
    timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramId: text("telegram_id").notNull().unique(),
    username: text("username"),
    isBlocked: boolean("is_blocked").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
});

export const admins = pgTable("admins", {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramId: text("telegram_id").notNull().unique(),
    role: text("role").notNull().default("admin"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Chains, assets, vaults                                              */
/* ------------------------------------------------------------------ */

export const chains = pgTable("chains", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    chainId: integer("chain_id").notNull().unique(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
});

export const assets = pgTable(
    "assets",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        chainId: uuid("chain_id")
            .notNull()
            .references(() => chains.id),
        symbol: text("symbol").notNull(),
        name: text("name").notNull(),
        tokenAddress: text("token_address").notNull(),
        decimals: integer("decimals").notNull(),
        isActive: boolean("is_active").notNull().default(true),
        createdAt: createdAt(),
    },
    (t) => [
        uniqueIndex("assets_chain_address_unique").on(
            t.chainId,
            t.tokenAddress,
        ),
    ],
);

// Deterministic per-user vault (CREATE2). May be counterfactual until deployed.
export const vaults = pgTable(
    "vaults",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id),
        chainId: uuid("chain_id")
            .notNull()
            .references(() => chains.id),
        nonce: integer("nonce").notNull().default(0),
        address: text("address").notNull(),
        isDeployed: boolean("is_deployed").notNull().default(false),
        deployTxHash: text("deploy_tx_hash"),
        isActive: boolean("is_active").notNull().default(true),
        createdAt: createdAt(),
    },
    (t) => [
        uniqueIndex("vaults_user_chain_nonce_unique").on(
            t.userId,
            t.chainId,
            t.nonce,
        ),
        uniqueIndex("vaults_chain_address_unique").on(t.chainId, t.address),
    ],
);

/* ------------------------------------------------------------------ */
/* Pools                                                               */
/* ------------------------------------------------------------------ */

// Five fixed pools, seeded by migration. Not admin-editable.
export const pools = pgTable("pools", {
    id: uuid("id").primaryKey().defaultRandom(),
    // liquid | lock_1m | lock_2m | lock_3m | manager
    key: text("key").notNull().unique(),
    label: text("label").notNull(),
    tier: integer("tier"), // 0..3 for participant pools, null for manager
    projectedApyBps: integer("projected_apy_bps").notNull(),
    lockMonths: integer("lock_months").notNull().default(0),
    isManager: boolean("is_manager").notNull().default(false),
});

// Current NAV/share state, one row per pool.
export const poolStates = pgTable(
    "pool_states",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        poolId: uuid("pool_id")
            .notNull()
            .unique()
            .references(() => pools.id),
        totalAssetsUsd: bigAmount("total_assets_usd").notNull().default("0"),
        totalShares: bigAmount("total_shares").notNull().default("0"),
        updatedAt: updatedAt(),
    },
    (t) => [
        check(
            "pool_states_nonneg",
            sql`${t.totalAssetsUsd} >= 0 AND ${t.totalShares} >= 0`,
        ),
    ],
);

/* ------------------------------------------------------------------ */
/* Settlements                                                         */
/* ------------------------------------------------------------------ */

// Immutable. Corrections are new settlements. settledAt is server time.
export const settlements = pgTable("settlements", {
    id: uuid("id").primaryKey().defaultRandom(),
    // manual: operator total-NAV entry. implicit: pre-action settle at
    // unchanged NAV (accrues nothing, just checkpoints time).
    kind: text("kind").notNull().default("manual"),
    previousTotalAssetsUsd: bigAmount("previous_total_assets_usd").notNull(),
    reportedTotalAssetsUsd: bigAmount("reported_total_assets_usd").notNull(),
    pnlUsd: numeric("pnl_usd", { precision: 78, scale: 0 }).notNull(), // signed
    intervalStart: timestamp("interval_start", {
        withTimezone: true,
    }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    adminId: uuid("admin_id").references(() => admins.id),
    note: text("note"),
});

// Auditable split of each settlement among pools.
// kind: loss | participant_yield | manager_excess | bonus_out | bonus_in
export const settlementAllocations = pgTable(
    "settlement_allocations",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        settlementId: uuid("settlement_id")
            .notNull()
            .references(() => settlements.id),
        poolId: uuid("pool_id")
            .notNull()
            .references(() => pools.id),
        kind: text("kind").notNull(),
        amountUsd: numeric("amount_usd", { precision: 78, scale: 0 }).notNull(), // signed
        navBeforeUsd: bigAmount("nav_before_usd").notNull(),
        navAfterUsd: bigAmount("nav_after_usd").notNull(),
        sharesAfter: bigAmount("shares_after").notNull(),
    },
    (t) => [index("settlement_alloc_settlement_idx").on(t.settlementId)],
);

/* ------------------------------------------------------------------ */
/* Deposits                                                            */
/* ------------------------------------------------------------------ */

// intent -> transfer_detected -> pending_review -> awaiting_user_approval
//   -> swept_and_confirmed | rejected | expired | cancelled
export const depositIntents = pgTable(
    "deposit_intents",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id),
        vaultId: uuid("vault_id")
            .notNull()
            .references(() => vaults.id),
        // Snapshot of exact chain + token contract at intent time.
        assetId: uuid("asset_id")
            .notNull()
            .references(() => assets.id),
        chainId: uuid("chain_id")
            .notNull()
            .references(() => chains.id),
        tokenAddress: text("token_address").notNull(),
        intendedAmount: bigAmount("intended_amount").notNull(), // token units
        status: text("status").notNull().default("intent"),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        // Set when operator confirms the swept actual amount.
        confirmedAmount: bigAmount("confirmed_amount"),
        confirmedAmountUsd: bigAmount("confirmed_amount_usd"),
        sweepTxHash: text("sweep_tx_hash"),
        sweptByAdminId: uuid("swept_by_admin_id").references(() => admins.id),
        sweptAt: timestamp("swept_at", { withTimezone: true }),
        // User must approve if confirmed amount != intended.
        userApprovedAmountAt: timestamp("user_approved_amount_at", {
            withTimezone: true,
        }),
        rejectionReason: text("rejection_reason"),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        index("deposit_intents_user_idx").on(t.userId, t.status),
        index("deposit_intents_vault_idx").on(t.vaultId, t.status),
    ],
);

// Chosen tier split for an intent, in basis points (must sum to 10000).
export const depositIntentAllocations = pgTable(
    "deposit_intent_allocations",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        intentId: uuid("intent_id")
            .notNull()
            .references(() => depositIntents.id),
        poolId: uuid("pool_id")
            .notNull()
            .references(() => pools.id),
        shareBps: integer("share_bps").notNull(),
    },
    (t) => [
        uniqueIndex("deposit_intent_alloc_unique").on(t.intentId, t.poolId),
        check(
            "deposit_intent_alloc_bps",
            sql`${t.shareBps} > 0 AND ${t.shareBps} <= 10000`,
        ),
    ],
);

// Onchain ERC-20 transfers into vaults. Identity: chain + tx hash + log index.
// intentId is null while unmatched (manual matching, never auto-credited).
export const depositTransfers = pgTable(
    "deposit_transfers",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        chainId: uuid("chain_id")
            .notNull()
            .references(() => chains.id),
        txHash: text("tx_hash").notNull(),
        logIndex: integer("log_index").notNull(),
        vaultId: uuid("vault_id")
            .notNull()
            .references(() => vaults.id),
        assetId: uuid("asset_id")
            .notNull()
            .references(() => assets.id),
        fromAddress: text("from_address"),
        amount: bigAmount("amount").notNull(),
        blockNumber: bigAmount("block_number"),
        blockHash: text("block_hash"),
        verifiedAt: timestamp("verified_at", { withTimezone: true }),
        // Evidence only. Earning starts at sweep confirmation.
        blockTimestamp: timestamp("block_timestamp", { withTimezone: true }),
        intentId: uuid("intent_id").references(() => depositIntents.id),
        // detected | pending_review | swept_and_confirmed | rejected
        status: text("status").notNull().default("detected"),
        createdAt: createdAt(),
    },
    (t) => [
        uniqueIndex("deposit_transfers_identity_unique").on(
            t.chainId,
            t.txHash,
            t.logIndex,
        ),
        index("deposit_transfers_intent_idx").on(t.intentId),
    ],
);

// Confirmed activation of an intent after a successful manual sweep.
export const deposits = pgTable("deposits", {
    id: uuid("id").primaryKey().defaultRandom(),
    intentId: uuid("intent_id")
        .notNull()
        .unique()
        .references(() => depositIntents.id),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
    amount: bigAmount("amount").notNull(),
    amountUsd: bigAmount("amount_usd").notNull(),
    sweepTxHash: text("sweep_tx_hash").notNull(),
    settlementId: uuid("settlement_id").references(() => settlements.id),
    confirmedByAdminId: uuid("confirmed_by_admin_id")
        .notNull()
        .references(() => admins.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Position lots                                                       */
/* ------------------------------------------------------------------ */

// A user's independently maturing stake in exactly one pool.
// source_type: deposit | relock | maturity | bonus
export const positionLots = pgTable(
    "position_lots",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id),
        poolId: uuid("pool_id")
            .notNull()
            .references(() => pools.id),
        shares: bigAmount("shares").notNull(),
        // Shares reserved by a pending withdrawal; cannot be relocked/requested.
        reservedShares: bigAmount("reserved_shares").notNull().default("0"),
        // Cost basis in USD for deposits/relocks, for yield display.
        principalUsd: bigAmount("principal_usd").notNull().default("0"),
        openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
        // Null for liquid lots.
        maturesAt: timestamp("matures_at", { withTimezone: true }),
        closedAt: timestamp("closed_at", { withTimezone: true }),
        sourceType: text("source_type").notNull(),
        sourceId: uuid("source_id"),
        // Lot this one was created from (relock / maturity).
        parentLotId: uuid("parent_lot_id"),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        index("position_lots_user_idx").on(t.userId, t.closedAt),
        index("position_lots_maturity_idx").on(t.maturesAt),
        check(
            "position_lots_shares_ok",
            sql`${t.shares} >= 0 AND ${t.reservedShares} >= 0 AND ${t.reservedShares} <= ${t.shares}`,
        ),
    ],
);

// One-time manager-funded bonus for an individual lot.
export const positionBonuses = pgTable("position_bonuses", {
    id: uuid("id").primaryKey().defaultRandom(),
    settlementId: uuid("settlement_id")
        .notNull()
        .references(() => settlements.id),
    positionLotId: uuid("position_lot_id")
        .notNull()
        .references(() => positionLots.id),
    amountUsd: bigAmount("amount_usd").notNull(),
    mintedShares: bigAmount("minted_shares").notNull(),
    grantedByAdminId: uuid("granted_by_admin_id")
        .notNull()
        .references(() => admins.id),
    createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Withdrawals                                                         */
/* ------------------------------------------------------------------ */

export const payoutAddresses = pgTable(
    "payout_addresses",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id),
        address: text("address").notNull(),
        lastUsedAt: timestamp("last_used_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        createdAt: createdAt(),
    },
    (t) => [uniqueIndex("payout_addresses_unique").on(t.userId, t.address)],
);

// pending -> paid | rejected | cancelled
export const withdrawals = pgTable(
    "withdrawals",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id),
        assetId: uuid("asset_id")
            .notNull()
            .references(() => assets.id),
        destinationAddress: text("destination_address").notNull(),
        grossAmountUsd: bigAmount("gross_amount_usd").notNull(),
        earlyFeeUsd: bigAmount("early_fee_usd").notNull().default("0"),
        netPayoutUsd: bigAmount("net_payout_usd").notNull(),
        // Token units paid out (1 USD = 1 token for now).
        payoutAmount: bigAmount("payout_amount").notNull(),
        status: text("status").notNull().default("pending"),
        rejectionReason: text("rejection_reason"),
        reviewedByAdminId: uuid("reviewed_by_admin_id").references(
            () => admins.id,
        ),
        reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
        processedByAdminId: uuid("processed_by_admin_id").references(
            () => admins.id,
        ),
        processedAt: timestamp("processed_at", { withTimezone: true }),
        txHash: text("tx_hash"),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        index("withdrawals_user_idx").on(t.userId, t.status),
        check(
            "withdrawals_paid_needs_tx",
            sql`${t.status} <> 'paid' OR ${t.txHash} IS NOT NULL`,
        ),
    ],
);

// Exact lot shares reserved/consumed by a withdrawal request.
export const withdrawalAllocations = pgTable(
    "withdrawal_allocations",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        withdrawalId: uuid("withdrawal_id")
            .notNull()
            .references(() => withdrawals.id),
        positionLotId: uuid("position_lot_id")
            .notNull()
            .references(() => positionLots.id),
        shares: bigAmount("shares").notNull(),
        grossAmountUsd: bigAmount("gross_amount_usd").notNull(),
        earlyFeeUsd: bigAmount("early_fee_usd").notNull().default("0"),
        netPayoutUsd: bigAmount("net_payout_usd").notNull(),
    },
    (t) => [index("withdrawal_alloc_idx").on(t.withdrawalId)],
);

/* ------------------------------------------------------------------ */
/* Ledger, idempotency, audit                                          */
/* ------------------------------------------------------------------ */

export const ledgerTransactions = pgTable("ledger_transactions", {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    createdByAdminId: uuid("created_by_admin_id").references(() => admins.id),
    createdAt: createdAt(),
});

// Append-only. Each transaction must balance: debits = credits.
export const ledgerEntries = pgTable(
    "ledger_entries",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        transactionId: uuid("transaction_id")
            .notNull()
            .references(() => ledgerTransactions.id),
        accountType: text("account_type").notNull(),
        poolId: uuid("pool_id").references(() => pools.id),
        userId: uuid("user_id").references(() => users.id),
        direction: text("direction").notNull(),
        amountUsd: bigAmount("amount_usd").notNull(),
        createdAt: createdAt(),
    },
    (t) => [
        check("ledger_direction_ok", sql`${t.direction} IN ('debit','credit')`),
        check("ledger_amount_pos", sql`${t.amountUsd} > 0`),
    ],
);

export const idempotencyKeys = pgTable(
    "idempotency_keys",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        scope: text("scope").notNull(),
        key: text("key").notNull(),
        requestHash: text("request_hash").notNull(),
        responseStatus: integer("response_status"),
        responseBody: jsonb("response_body"),
        createdAt: createdAt(),
    },
    (t) => [uniqueIndex("idempotency_scope_key_unique").on(t.scope, t.key)],
);

export const auditLogs = pgTable("audit_logs", {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id")
        .notNull()
        .references(() => admins.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details"),
    createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Relock queue                                                        */
/* ------------------------------------------------------------------ */

// Queued until the next settlement, then applied at that settlement's
// prices. status: pending | applied | failed | cancelled
export const relockRequests = pgTable(
    "relock_requests",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id),
        status: text("status").notNull().default("pending"),
        settlementId: uuid("settlement_id").references(() => settlements.id),
        appliedAt: timestamp("applied_at", { withTimezone: true }),
        createdAt: createdAt(),
    },
    (t) => [index("relock_requests_user_idx").on(t.userId, t.status)],
);

// One source lot -> one target tier. Splitting = several items.
// status: pending | applied | failed | cancelled
export const relockItems = pgTable(
    "relock_items",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        requestId: uuid("request_id")
            .notNull()
            .references(() => relockRequests.id),
        sourceLotId: uuid("source_lot_id")
            .notNull()
            .references(() => positionLots.id),
        targetPoolId: uuid("target_pool_id")
            .notNull()
            .references(() => pools.id),
        amountUsd: bigAmount("amount_usd"), // null when isMax
        isMax: boolean("is_max").notNull().default(false),
        reservedShares: bigAmount("reserved_shares").notNull(),
        status: text("status").notNull().default("pending"),
        failureReason: text("failure_reason"),
        appliedShares: bigAmount("applied_shares"),
        appliedUsd: bigAmount("applied_usd"),
        resultLotId: uuid("result_lot_id").references(() => positionLots.id),
    },
    (t) => [
        index("relock_items_request_idx").on(t.requestId),
        index("relock_items_status_idx").on(t.status),
    ],
);

/* ------------------------------------------------------------------ */
/* Balance history (for historical APY and charts)                     */
/* ------------------------------------------------------------------ */

// One row per user per settlement: participant value right after the
// settlement (price update, maturity, relocks) and BEFORE that action's
// deposit/withdrawal flows. Manager-pool holdings are excluded.
export const userBalanceSnapshots = pgTable(
    "user_balance_snapshots",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id),
        settlementId: uuid("settlement_id")
            .notNull()
            .references(() => settlements.id),
        takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
        valueUsd: bigAmount("value_usd").notNull(),
        principalUsd: bigAmount("principal_usd").notNull(),
        liquidValueUsd: bigAmount("liquid_value_usd").notNull(),
        lockedValueUsd: bigAmount("locked_value_usd").notNull(),
    },
    (t) => [
        uniqueIndex("ubs_user_settlement_unique").on(t.userId, t.settlementId),
        index("ubs_user_time_idx").on(t.userId, t.takenAt),
    ],
);

// External cash flows applied right after a settlement. Signed micro-USD:
// deposits positive, withdrawals negative (gross value burned).
// kind: deposit | withdrawal. Relocks and maturities are not flows.
export const userFlows = pgTable(
    "user_flows",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id),
        settlementId: uuid("settlement_id")
            .notNull()
            .references(() => settlements.id),
        kind: text("kind").notNull(),
        amountUsd: bigAmount("amount_usd").notNull(),
        createdAt: createdAt(),
    },
    (t) => [index("user_flows_user_idx").on(t.userId, t.settlementId)],
);

// Pool NAV and shares after every settlement (admin gross performance).
export const poolSnapshots = pgTable(
    "pool_snapshots",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        settlementId: uuid("settlement_id")
            .notNull()
            .references(() => settlements.id),
        poolId: uuid("pool_id")
            .notNull()
            .references(() => pools.id),
        takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
        totalAssetsUsd: bigAmount("total_assets_usd").notNull(),
        totalShares: bigAmount("total_shares").notNull(),
    },
    (t) => [
        uniqueIndex("pool_snapshots_unique").on(t.settlementId, t.poolId),
        index("pool_snapshots_time_idx").on(t.poolId, t.takenAt),
    ],
);

// Per-chain scan cursor for the background transfer scanner.
export const chainScanState = pgTable("chain_scan_state", {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: uuid("chain_id")
        .notNull()
        .unique()
        .references(() => chains.id),
    lastScannedBlock: bigAmount("last_scanned_block").notNull(),
    updatedAt: updatedAt(),
});
