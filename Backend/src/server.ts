import { buildApp } from "./app.js";
import { config } from "./config.js";
import { ensureOwnerAdmin } from "./bootstrap.js";
import { pool } from "./db/index.js";
import { startScanner } from "./chain/scheduler.js";
import { startOutbox } from "./services/outbox.js";
import { startBot } from "./bot/bot.js";
import { getCreationBytecode } from "./chain/vaultAddress.js";

const app = await buildApp();

try {
    // Fail at startup, not on first vault call, if the pinned bytecode hash is wrong.
    if (config.VAULT_ARTIFACT_PATH) getCreationBytecode();
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
