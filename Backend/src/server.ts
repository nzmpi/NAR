import "dotenv/config";
import Fastify from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db, pool } from "./db/index.js";
import { confirmDeposit } from "./services/deposits.js";

function getPostgresErrorCode(error: unknown): string | undefined {
    let current = error;

    while (current instanceof Error) {
        if ("code" in current && typeof current.code === "string") {
            return current.code;
        }

        current = "cause" in current ? current.cause : undefined;
    }

    return undefined;
}

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

const confirmDepositSchema = z.object({
    userId: z.string().uuid(),
    vaultId: z.string().uuid(),
    assetId: z.string().uuid(),
    amount: z.string().regex(/^[0-9]+$/),
    txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    transferIndex: z.number().int().nonnegative(),
});

app.post("/admin/deposits/confirm", async (request, reply) => {
    // Development guard only. This is not real authentication.
    const adminId = process.env.DEV_ADMIN_ID;

    if (!adminId) {
        return reply.code(503).send({
            error: "Development admin is not configured",
        });
    }

    const parsed = confirmDepositSchema.safeParse(request.body);

    if (!parsed.success) {
        return reply.code(400).send({
            error: "Invalid request",
            details: parsed.error.issues,
        });
    }

    try {
        const result = await confirmDeposit({
            ...parsed.data,
            adminId,
        });

        return reply.code(201).send(result);
    } catch (error) {
        if (error instanceof Error) {
            const knownErrors: Record<string, number> = {
                "Deposit amount must be positive": 400,
                "Invalid transfer index": 400,
                "Invalid transaction hash": 400,
                "Active administrator not found": 403,
                "Active user not found": 404,
                "Active vault not found for this user": 404,
                "Asset is not supported on this vault's chain": 400,
                "Unsupported stablecoin": 400,
                "Unsupported token decimals": 400,
                "Deposit is too small to represent in microdollars": 400,
                "Deposit would mint zero shares": 400,
            };

            const statusCode = knownErrors[error.message];

            if (statusCode) {
                return reply.code(statusCode).send({
                    error: error.message,
                });
            }

            // A duplicate deposit can violate the unique database constraint.
            if (getPostgresErrorCode(error) === "23505") {
                return reply.code(409).send({
                    error: "This transfer has already been recorded",
                });
            }
        }

        app.log.error(error);

        return reply.code(500).send({
            error: "Failed to confirm deposit",
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
