import { buildApp } from "./app.js";
import { config } from "./config.js";
import { ensureOwnerAdmin } from "./bootstrap.js";
import { pool } from "./db/index.js";
import { startScanner } from "./chain/scheduler.js";
import { startOutbox } from "./services/outbox.js";
import { startBot } from "./bot/bot.js";

const app = await buildApp();

try {
    await ensureOwnerAdmin();
    await app.listen({ port: config.PORT, host: config.HOST });
    startScanner(app.log);
    startOutbox(app.log);
    await startBot(app.log);
} catch (error) {
    app.log.error(error);
    await pool.end();
    process.exit(1);
}
