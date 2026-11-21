import { config } from "../config.js";
import { db } from "../db/index.js";
import { expireStaleIntents } from "../services/depositIntents.js";
import { beat } from "../heartbeat.js";

type Log = { error: (...a: unknown[]) => void };

// Periodically expires stale deposit intents (24h). Chains are not scanned on
// a timer (RPC rate limits): the admin's "Check vaults" button and the user's
// "I sent it" do that. SCAN_INTERVAL_SECONDS=0 disables it.
export function startScanner(log: Log) {
    if (config.SCAN_INTERVAL_SECONDS === 0) return;
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            await expireStaleIntents(db);
            beat("scanner");
        } catch (e) {
            log.error(e);
        } finally {
            running = false;
        }
    };
    setInterval(() => void tick(), config.SCAN_INTERVAL_SECONDS * 1000).unref();
    void tick();
}
