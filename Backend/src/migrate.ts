// Applies drizzle/ migrations; run as a separate step (see deploy/RUNBOOK.md). Same journal table as `drizzle-kit migrate`.
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./db/index.js";

try {
    await migrate(db, { migrationsFolder: "drizzle" });
    console.log("migrations applied");
} finally {
    await pool.end();
}
