import { and, eq, lte, sql } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { notificationOutbox, users } from "../db/schema.js";
import { beat } from "../heartbeat.js";

type Log = { error: (...a: unknown[]) => void };
type Database = Pick<typeof db, "insert">;

const MAX_ATTEMPTS = 8;
const BATCH = 20;

// Insert only. Pass a tx to make the message atomic with the money operation.
export async function enqueueNotification(
    database: Database,
    userId: string,
    text: string,
) {
    await database
        .insert(notificationOutbox)
        .values({ userId, text: text.slice(0, 4000) });
}

// 30s, 1m, 2m, 4m ... capped at 1h.
function backoffMs(attempts: number) {
    return Math.min(30_000 * 2 ** (attempts - 1), 3_600_000);
}

type SendResult =
    | { ok: true }
    | { ok: false; permanent: boolean; retryAfterMs?: number; error: string };

async function sendTelegram(chatId: string, text: string): Promise<SendResult> {
    try {
        const res = await fetch(
            `https://api.telegram.org/bot${config.BOT_TOKEN}/sendMessage`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text }),
                signal: AbortSignal.timeout(10_000),
            },
        );
        if (res.ok) return { ok: true };
        const body = (await res.json().catch(() => ({}))) as {
            description?: string;
            parameters?: { retry_after?: number };
        };
        const error = `${res.status} ${body.description ?? ""}`.trim();
        if (res.status === 429)
            return {
                ok: false,
                permanent: false,
                retryAfterMs: (body.parameters?.retry_after ?? 30) * 1000,
                error,
            };
        // 400/403: chat not found, user blocked the bot. Retrying will not help.
        if (res.status === 400 || res.status === 403)
            return { ok: false, permanent: true, error };
        return { ok: false, permanent: false, error };
    } catch (e) {
        return {
            ok: false,
            permanent: false,
            error: e instanceof Error ? e.message : String(e),
        };
    }
}

// Claims a batch with SKIP LOCKED, sends, records the outcome. Returns rows handled.
export async function drainOutbox(log: Log): Promise<number> {
    return db.transaction(async (tx) => {
        const rows = await tx
            .select({ n: notificationOutbox, tg: users.telegramId })
            .from(notificationOutbox)
            .innerJoin(users, eq(users.id, notificationOutbox.userId))
            .where(
                and(
                    eq(notificationOutbox.status, "pending"),
                    lte(notificationOutbox.nextAttemptAt, sql`now()`),
                ),
            )
            .orderBy(notificationOutbox.createdAt)
            .limit(BATCH)
            .for("update", { of: notificationOutbox, skipLocked: true });
        for (const { n, tg } of rows) {
            const r = await sendTelegram(tg, n.text);
            if (r.ok) {
                await tx
                    .update(notificationOutbox)
                    .set({
                        status: "sent",
                        sentAt: new Date(),
                        attempts: n.attempts + 1,
                        lastError: null,
                    })
                    .where(eq(notificationOutbox.id, n.id));
                continue;
            }
            const attempts = n.attempts + 1;
            const dead = r.permanent || attempts >= MAX_ATTEMPTS;
            if (dead) log.error(`notification ${n.id} failed: ${r.error}`);
            await tx
                .update(notificationOutbox)
                .set({
                    status: dead ? "failed" : "pending",
                    attempts,
                    lastError: r.error,
                    nextAttemptAt: new Date(
                        Date.now() + (r.retryAfterMs ?? backoffMs(attempts)),
                    ),
                })
                .where(eq(notificationOutbox.id, n.id));
        }
        return rows.length;
    });
}

// OUTBOX_INTERVAL_SECONDS=0 disables the worker.
export function startOutbox(log: Log) {
    if (config.OUTBOX_INTERVAL_SECONDS === 0) return;
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            while ((await drainOutbox(log)) === BATCH) {
                /* keep draining */
            }
            beat("outbox");
        } catch (e) {
            log.error(e);
        } finally {
            running = false;
        }
    };
    setInterval(
        () => void tick(),
        config.OUTBOX_INTERVAL_SECONDS * 1000,
    ).unref();
    void tick();
}
