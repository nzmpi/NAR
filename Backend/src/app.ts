import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { sql } from "drizzle-orm";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { registerErrorHandler } from "./http/errors.js";
import { adminAuthRoutes } from "./http/routes/adminAuth.js";
import { adminRoutes } from "./http/routes/admin.js";
import { userRoutes } from "./http/routes/user.js";
import { registerBotWebhook } from "./bot/bot.js";
import { workerStatus } from "./heartbeat.js";

// bigint -> JSON string (money is exchanged as integer strings).
(BigInt.prototype as any).toJSON = function (this: bigint) {
    return this.toString();
};

export async function buildApp() {
    const app = Fastify({
        logger: true,
        trustProxy:
            config.TRUST_PROXY_HOPS > 0
                ? String(config.TRUST_PROXY_HOPS)
                : false,
        bodyLimit: 64 * 1024,
        requestTimeout: 30_000,
        connectionTimeout: 30_000,
    });

    await app.register(helmet);
    await app.register(rateLimit, {
        global: true,
        max: config.RATE_LIMIT_PER_MINUTE,
        timeWindow: "1 minute",
        allowList: (req) => req.url === "/health",
    });
    await app.register(cookie);
    await app.register(cors, {
        origin: config.CORS_ORIGIN_LIST,
        credentials: true,
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: [
            "Authorization",
            "Content-Type",
            "Idempotency-Key",
            "X-Requested-With",
        ],
    });
    registerErrorHandler(app);

    app.get("/health", async () => ({ status: "ok" }));
    app.get("/health/db", async (_req, reply) => {
        try {
            await db.execute(sql`SELECT 1`);
            return { status: "ok", database: "connected" };
        } catch (e) {
            app.log.error(e);
            return reply
                .code(503)
                .send({ status: "error", database: "unavailable" });
        }
    });

    // Uptime monitor target: 503 if the DB is down or a background loop stalled.
    app.get("/health/ready", async (_req, reply) => {
        const r = {
            database: "ok",
            scanner: workerStatus("scanner", config.SCAN_INTERVAL_SECONDS),
            outbox: workerStatus("outbox", config.OUTBOX_INTERVAL_SECONDS),
        };
        try {
            await db.execute(sql`SELECT 1`);
        } catch (e) {
            app.log.error(e);
            r.database = "unavailable";
        }
        const ok =
            r.database === "ok" &&
            r.scanner !== "stalled" &&
            r.outbox !== "stalled";
        return reply
            .code(ok ? 200 : 503)
            .send({ status: ok ? "ok" : "error", ...r });
    });

    await app.register(userRoutes);
    await app.register(adminAuthRoutes);
    await app.register(adminRoutes);
    registerBotWebhook(app);
    return app;
}
