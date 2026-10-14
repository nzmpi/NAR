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
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramId: text("telegram_id").notNull().unique(),
    username: text("username"),
    isBlocked: boolean("is_blocked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

export const admins = pgTable("admins", {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramId: text("telegram_id").notNull().unique(),
    role: text("role").notNull().default("admin"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

export const chains = pgTable("chains", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    chainId: integer("chain_id").notNull().unique(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
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
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        uniqueIndex("assets_chain_address_unique").on(
            table.chainId,
            table.tokenAddress,
        ),
    ],
);

export const vaults = pgTable("vaults", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
    chainId: uuid("chain_id")
        .notNull()
        .references(() => chains.id),
    address: text("address").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// One pool per asset on its respective chain.
// Amounts use the token's smallest units.
// Shares use 18-decimal fixed-point units.
export const poolStates = pgTable("pool_states", {
    id: uuid("id").primaryKey().defaultRandom(),
    totalAssetsUsd: numeric("total_assets_usd", {
        precision: 78,
        scale: 0,
    })
        .notNull()
        .default("0"),
    totalShares: numeric("total_shares", {
        precision: 78,
        scale: 0,
    })
        .notNull()
        .default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// A user's position in a particular asset.
// Assets change with yield; shares change with deposits and withdrawals.
export const userPositions = pgTable("user_positions", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id)
        .unique(),
    assetsUsd: numeric("assets_usd", {
        precision: 78,
        scale: 0,
    })
        .notNull()
        .default("0"),
    shares: numeric("shares", {
        precision: 78,
        scale: 0,
    })
        .notNull()
        .default("0"),
    reservedAssetsUsd: numeric("reserved_assets_usd", {
        precision: 78,
        scale: 0,
    })
        .notNull()
        .default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// Records only deposits verified by an administrator.
export const deposits = pgTable(
    "deposits",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id),
        vaultId: uuid("vault_id")
            .notNull()
            .references(() => vaults.id),
        assetId: uuid("asset_id")
            .notNull()
            .references(() => assets.id),
        amount: numeric("amount", {
            precision: 78,
            scale: 0,
        }).notNull(),
        amountUsd: numeric("amount_usd", {
            precision: 78,
            scale: 0,
        }).notNull(),
        txHash: text("tx_hash").notNull(),
        transferIndex: integer("transfer_index").notNull(),
        confirmedByAdminId: uuid("confirmed_by_admin_id")
            .notNull()
            .references(() => admins.id),
        confirmedAt: timestamp("confirmed_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        uniqueIndex("deposits_asset_tx_transfer_unique").on(
            table.assetId,
            table.txHash,
            table.transferIndex,
        ),
    ],
);

// Withdrawal requests submitted by users and handled by administrators.
export const withdrawals = pgTable("withdrawals", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
    assetId: uuid("asset_id")
        .notNull()
        .references(() => assets.id),
    amount: numeric("amount", {
        precision: 78,
        scale: 0,
    }).notNull(),
    amountUsd: numeric("amount_usd", {
        precision: 78,
        scale: 0,
    }),
    destinationAddress: text("destination_address").notNull(),
    status: text("status").notNull().default("pending"),
    reviewedByAdminId: uuid("reviewed_by_admin_id").references(() => admins.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    processedByAdminId: uuid("processed_by_admin_id").references(
        () => admins.id,
    ),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    txHash: text("tx_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// Groups the ledger entries belonging to one financial operation.
export const ledgerTransactions = pgTable("ledger_transactions", {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    createdByAdminId: uuid("created_by_admin_id").references(() => admins.id),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// Append-only financial entries.
// Each transaction must balance per asset: total debits = total credits.
export const ledgerEntries = pgTable("ledger_entries", {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
        .notNull()
        .references(() => ledgerTransactions.id),
    accountType: text("account_type").notNull(),
    direction: text("direction").notNull(),
    amountUsd: numeric("amount_usd", {
        precision: 78,
        scale: 0,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// Prevents duplicate processing of retried API requests.
export const idempotencyKeys = pgTable(
    "idempotency_keys",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        scope: text("scope").notNull(),
        key: text("key").notNull(),
        requestHash: text("request_hash").notNull(),
        responseStatus: integer("response_status"),
        responseBody: jsonb("response_body"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        uniqueIndex("idempotency_scope_key_unique").on(table.scope, table.key),
    ],
);

// Records important administrator actions.
export const auditLogs = pgTable("audit_logs", {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id")
        .notNull()
        .references(() => admins.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});
