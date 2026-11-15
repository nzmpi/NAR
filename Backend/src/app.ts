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

    await app.register(userRoutes);
    await app.register(adminAuthRoutes);
    await app.register(adminRoutes);
    registerBotWebhook(app);
    return app;
}
