import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { chains } from "../db/schema.js";
import { hasRpc } from "./client.js";
import { expireStaleIntents } from "../services/depositIntents.js";
import { scanChain } from "../services/transferScanner.js";

type Log = { error: (...a: unknown[]) => void };

// Periodically scans active chains for transfers into known vaults and
// expires stale deposit intents (24h). SCAN_INTERVAL_SECONDS=0 disables it.
export function startScanner(log: Log) {
    if (config.SCAN_INTERVAL_SECONDS === 0) return;
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            await expireStaleIntents(db);
            const active = await db
                .select()
                .from(chains)
                .where(eq(chains.isActive, true));
            for (const c of active) {
                if (!hasRpc(c.chainId)) continue;
                try {
                    await scanChain(db, { id: c.id, chainId: c.chainId });
                } catch (e) {
                    log.error(e);
                }
            }
        } catch (e) {
            log.error(e);
        } finally {
            running = false;
        }
    };
    setInterval(() => void tick(), config.SCAN_INTERVAL_SECONDS * 1000).unref();
    void tick();
}
