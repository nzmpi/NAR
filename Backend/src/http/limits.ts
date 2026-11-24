import type { FastifyRequest } from "fastify";
import { AppError } from "../errors.js";

// Per-user fixed-window limiter (in memory, single instance). Use it AFTER
// requireUser: preHandler: [requireUser, userLimit("write", 20)].
// The per-IP limit for unauthenticated traffic is @fastify/rate-limit in app.ts.
const WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
}, WINDOW_MS).unref();

export function userLimit(bucket: string, maxPerMinute: number) {
    return async (req: FastifyRequest) => {
        const id = req.user?.id ?? req.tg?.telegramId ?? req.ip;
        const key = `${bucket}:${id}`;
        const now = Date.now();
        let h = hits.get(key);
        if (!h || h.resetAt <= now) {
            h = { count: 0, resetAt: now + WINDOW_MS };
            hits.set(key, h);
        }
        if (++h.count > maxPerMinute) {
            throw new AppError("Too many requests", 429, "rate_limited");
        }
    };
}
