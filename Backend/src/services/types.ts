import type { PgDatabase } from "drizzle-orm/pg-core";

// Works for node-postgres (prod) and PGlite (tests); also for transactions.
export type Database = PgDatabase<any, any, any>;
export type Tx = PgDatabase<any, any, any>;
