import { db } from "../db/index.js";
import { drainOutbox, enqueueNotification } from "./outbox.js";

type Log = { error: (...a: unknown[]) => void };

// micro-USD -> "1234.50"
export function fmtUsd(micro: bigint): string {
    const whole = micro / 1_000_000n;
    const cents = (micro % 1_000_000n) / 10_000n;
    return `${whole.toString()}.${cents.toString().padStart(2, "0")}`;
}

// Queues the message and sends it now; the hourly outbox worker retries
// failures. A failed enqueue never fails the money operation.
export async function notifyUser(userId: string, text: string, log: Log) {
    try {
        await enqueueNotification(db, userId, text);
    } catch (e) {
        log.error(e);
        return;
    }
    sendQueued(log);
}

// Delivers queued messages without waiting for the worker, which runs hourly
// so the free Neon compute can sleep.
export function sendQueued(log: Log) {
    void drainOutbox(log).catch((e) => log.error(e));
}
