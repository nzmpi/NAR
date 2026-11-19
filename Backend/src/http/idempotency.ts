import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { db } from "../db/index.js";
import { idempotencyKeys } from "../db/schema.js";
import { AppError } from "../errors.js";

const STALE_MS = 10 * 60 * 1000;

// Requires an `Idempotency-Key` header. A retry with the same key and body
// replays the stored response; the same key with a different body is rejected.
export async function idempotent(
    req: FastifyRequest,
    actorId: string,
    successStatus: number,
    run: () => Promise<unknown>,
): Promise<{ status: number; body: unknown }> {
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 128)
        throw new AppError(
            "Idempotency-Key header (8-128 chars) is required",
            400,
            "idempotency_key",
        );

    // Concrete path, not the route pattern: /x/:id calls for different ids never share a key.
    const scope = `${actorId}:${req.method}:${req.url.split("?")[0]}`;
    const requestHash = createHash("sha256")
        .update(JSON.stringify(req.body ?? null))
        .digest("hex");

    for (let attempt = 0; attempt < 2; attempt++) {
        const inserted = await db
            .insert(idempotencyKeys)
            .values({ scope, key, requestHash })
            .onConflictDoNothing()
            .returning({ id: idempotencyKeys.id });
        if (inserted.length) break;

        const [row] = await db
            .select()
            .from(idempotencyKeys)
            .where(
                and(
                    eq(idempotencyKeys.scope, scope),
                    eq(idempotencyKeys.key, key),
                ),
            )
            .limit(1);
        if (!row) continue;
        if (row.requestHash !== requestHash)
            throw new AppError(
                "Idempotency key reused with a different request",
                422,
                "idempotency_mismatch",
            );
        if (row.responseStatus !== null)
            return { status: row.responseStatus, body: row.responseBody };
        if (Date.now() - row.createdAt.getTime() > STALE_MS) {
            await db
                .delete(idempotencyKeys)
                .where(eq(idempotencyKeys.id, row.id));
            continue;
        }
        throw new AppError(
            "A request with this key is still in progress",
            409,
            "in_progress",
        );
    }

    try {
        const result = await run();
        const body = JSON.parse(JSON.stringify(result ?? null)); // bigint -> string
        await db
            .update(idempotencyKeys)
            .set({ responseStatus: successStatus, responseBody: body })
            .where(
                and(
                    eq(idempotencyKeys.scope, scope),
                    eq(idempotencyKeys.key, key),
                ),
            );
        return { status: successStatus, body };
    } catch (e) {
        await db
            .delete(idempotencyKeys)
            .where(
                and(
                    eq(idempotencyKeys.scope, scope),
                    eq(idempotencyKeys.key, key),
                ),
            );
        throw e;
    }
}
