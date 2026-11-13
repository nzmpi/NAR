import { buildApp } from "./app.js";
import { config } from "./config.js";
import { ensureOwnerAdmin } from "./bootstrap.js";
import { pool } from "./db/index.js";

const app = await buildApp();

try {
    await ensureOwnerAdmin();
    await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
    app.log.error(error);
    await pool.end();
    process.exit(1);
}
