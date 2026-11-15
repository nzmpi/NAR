import { db } from "../db/index.js";
import { enqueueNotification } from "./outbox.js";

type Log = { error: (...a: unknown[]) => void };

// micro-USD -> "1234.50"
export function fmtUsd(micro: bigint): string {
    const whole = micro / 1_000_000n;
    const cents = (micro % 1_000_000n) / 10_000n;
    return `${whole.toString()}.${cents.toString().padStart(2, "0")}`;
}

// Queues the message; the outbox worker delivers it with retries.
// A failed enqueue never fails the money operation.
export async function notifyUser(userId: string, text: string, log: Log) {
    try {
        await enqueueNotification(db, userId, text);
    } catch (e) {
        log.error(e);
    }
}
