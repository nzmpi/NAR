import "dotenv/config";
import Fastify from "fastify";
import { sql } from "drizzle-orm";
import { db, pool } from "./db/index.js";

const app = Fastify({
    logger: true,
});

app.get("/health", async () => {
    return {
        status: "ok",
    };
});

app.get("/health/db", async (_request, reply) => {
    try {
        await db.execute(sql`SELECT 1`);

        return {
            status: "ok",
            database: "connected",
        };
    } catch (error) {
        app.log.error(error);

        return reply.code(503).send({
            status: "error",
            database: "unavailable",
        });
    }
});

const port = Number(process.env.PORT ?? 3000);

try {
    await app.listen({
        port,
        host: "127.0.0.1",
    });
} catch (error) {
    app.log.error(error);
    await pool.end();
    process.exit(1);
}
