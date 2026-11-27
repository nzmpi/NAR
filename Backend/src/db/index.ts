import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
}

export const pool = new Pool({
    connectionString,
});
// Neon closes idle connections; without a listener the pool's "error" event
// would crash the process.
pool.on("error", (e) => console.error("pg pool error", e));

export const db = drizzle({ client: pool });
