import {
    pgTable,
    uuid,
    text,
    boolean,
    timestamp,
    integer,
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
