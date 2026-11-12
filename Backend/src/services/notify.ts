import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";

type Log = { error: (...a: unknown[]) => void };

// micro-USD -> "1234.50"
export function fmtUsd(micro: bigint): string {
    const whole = micro / 1_000_000n;
    const cents = (micro % 1_000_000n) / 10_000n;
    return `${whole.toString()}.${cents.toString().padStart(2, "0")}`;
}

// Best effort: a failed notification never fails the money operation.
export async function notifyUser(userId: string, text: string, log: Log) {
    try {
        const [u] = await db
            .select({ tg: users.telegramId })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        if (!u) return;
        const res = await fetch(
            `https://api.telegram.org/bot${config.BOT_TOKEN}/sendMessage`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ chat_id: u.tg, text }),
            },
        );
        if (!res.ok) log.error(`telegram notify failed: ${res.status}`);
    } catch (e) {
        log.error(e);
    }
}
