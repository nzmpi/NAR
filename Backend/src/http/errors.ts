import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../errors.js";

export function pgErrorCode(error: unknown): string | undefined {
    let cur = error;
    while (cur instanceof Error) {
        if ("code" in cur && typeof cur.code === "string") return cur.code;
        cur = "cause" in cur ? cur.cause : undefined;
    }
    return undefined;
}

export function registerErrorHandler(app: FastifyInstance) {
    app.setErrorHandler((err: FastifyError, req, reply) => {
        if (err instanceof AppError)
            return reply
                .code(err.status)
                .send({ error: err.message, code: err.code });
        if (err instanceof ZodError)
            return reply.code(400).send({
                error: "Invalid request",
                code: "validation",
                details: err.issues,
            });

        const pg = pgErrorCode(err);
        if (pg === "23505")
            return reply
                .code(409)
                .send({ error: "Already recorded", code: "duplicate" });
        if (pg === "23514")
            return reply.code(409).send({
                error: "Conflicts with current balances or state",
                code: "conflict",
            });
        if (pg === "40001" || pg === "40P01")
            return reply
                .code(503)
                .send({ error: "Busy, please retry", code: "retry" });

        if (err.statusCode && err.statusCode < 500)
            return reply
                .code(err.statusCode)
                .send({ error: err.message, code: "bad_request" });

        req.log.error(err);
        return reply
            .code(500)
            .send({ error: "Internal error", code: "internal" });
    });
}
