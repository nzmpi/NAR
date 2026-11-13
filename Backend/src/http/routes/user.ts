import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/index.js";
import { requireUser } from "../auth.js";
import { idempotent } from "../idempotency.js";
import {
    big,
    idParam,
    lockKey,
    poolKey,
    uuid,
    evmAddress,
    txHash,
} from "../schemas.js";
import {
    approveAmount,
    cancelIntent,
    createIntent,
} from "../../services/depositIntents.js";
import {
    cancelWithdrawal,
    previewWithdrawal,
    requestWithdrawal,
} from "../../services/withdrawals.js";
import { cancelRelock, requestRelock } from "../../services/relocks.js";
import {
    getPortfolio,
    listAssets,
    listPayoutAddresses,
    listUserDeposits,
    listUserRelocks,
    listUserVaults,
    listUserWithdrawals,
} from "../../services/queries.js";
import { computePerformance } from "../../services/history.js";
import {
    attachTxToIntent,
    checkIntent,
} from "../../services/transferScanner.js";

const intentBody = z.object({
    vaultId: uuid,
    assetId: uuid,
    intendedAmount: big, // token base units
    allocations: z
        .array(
            z.object({
                pool: poolKey,
                bps: z.number().int().positive().max(10_000),
            }),
        )
        .min(1)
        .max(4),
});

const withdrawalBody = z.object({
    assetId: uuid,
    destinationAddress: evmAddress,
    amountUsd: big, // micro-USD gross
    lockSelections: z
        .array(
            z.object({
                lotId: uuid,
                grossUsd: big.optional(),
                max: z.boolean().optional(),
            }),
        )
        .max(20)
        .optional(),
});

const relockBody = z.object({
    items: z
        .array(
            z.object({
                lotId: uuid,
                targetPool: lockKey,
                amountUsd: big.optional(),
                max: z.boolean().optional(),
            }),
        )
        .min(1)
        .max(20),
});

export async function userRoutes(app: FastifyInstance) {
    const auth = { preHandler: requireUser };

    app.get("/me", auth, async (req) => req.user);
    app.get("/assets", auth, async () => listAssets(db));
    app.get("/me/vaults", auth, async (req) =>
        listUserVaults(db, req.user!.id),
    );
    app.get("/me/portfolio", auth, async (req) =>
        getPortfolio(db, req.user!.id),
    );
    app.get("/me/performance", auth, async (req) => {
        const q = z
            .object({
                range: z.enum(["1w", "1m", "3m", "1y", "all"]).default("1m"),
            })
            .parse(req.query);
        return computePerformance(db, req.user!.id, q.range);
    });

    /* deposits */
    app.get("/me/deposits", auth, async (req) =>
        listUserDeposits(db, req.user!.id),
    );

    app.post("/me/deposits/intents", auth, async (req, reply) => {
        const b = intentBody.parse(req.body);
        const r = await idempotent(req, req.user!.id, 201, () =>
            createIntent(db, {
                userId: req.user!.id,
                vaultId: b.vaultId,
                assetId: b.assetId,
                intendedAmount: b.intendedAmount,
                allocations: b.allocations.map((a) => ({
                    poolKey: a.pool,
                    bps: a.bps,
                })),
            }),
        );
        return reply.code(r.status).send(r.body);
    });

    app.post("/me/deposits/intents/:id/cancel", auth, async (req, reply) => {
        const { id } = idParam.parse(req.params);
        await cancelIntent(db, id, req.user!.id);
        return reply.code(204).send();
    });

    app.post(
        "/me/deposits/intents/:id/approve-amount",
        auth,
        async (req, reply) => {
            const { id } = idParam.parse(req.params);
            await approveAmount(db, { intentId: id, userId: req.user!.id });
            return reply.code(204).send();
        },
    );

    app.post("/me/deposits/intents/:id/check", auth, async (req) => {
        const { id } = idParam.parse(req.params);
        return checkIntent(db, id, req.user!.id);
    });

    app.post("/me/deposits/intents/:id/tx-hash", auth, async (req) => {
        const { id } = idParam.parse(req.params);
        const b = z.object({ txHash }).parse(req.body);
        return attachTxToIntent(db, {
            intentId: id,
            userId: req.user!.id,
            txHash: b.txHash,
        });
    });

    /* withdrawals */
    app.get("/me/withdrawals", auth, async (req) =>
        listUserWithdrawals(db, req.user!.id),
    );
    app.get("/me/payout-addresses", auth, async (req) =>
        listPayoutAddresses(db, req.user!.id),
    );

    app.post("/me/withdrawals/preview", auth, async (req) => {
        const b = withdrawalBody.parse(req.body);
        return previewWithdrawal(db, { userId: req.user!.id, ...b });
    });

    app.post("/me/withdrawals", auth, async (req, reply) => {
        const b = withdrawalBody.parse(req.body);
        const r = await idempotent(req, req.user!.id, 201, () =>
            requestWithdrawal(db, { userId: req.user!.id, ...b }),
        );
        return reply.code(r.status).send(r.body);
    });

    app.post("/me/withdrawals/:id/cancel", auth, async (req, reply) => {
        const { id } = idParam.parse(req.params);
        await cancelWithdrawal(db, { withdrawalId: id, userId: req.user!.id });
        return reply.code(204).send();
    });

    /* relocks (queued until the next settlement) */
    app.get("/me/relocks", auth, async (req) =>
        listUserRelocks(db, req.user!.id),
    );

    app.post("/me/relocks", auth, async (req, reply) => {
        const b = relockBody.parse(req.body);
        const r = await idempotent(req, req.user!.id, 201, () =>
            requestRelock(db, {
                userId: req.user!.id,
                items: b.items.map((i) => ({
                    lotId: i.lotId,
                    targetPoolKey: i.targetPool,
                    amountUsd: i.amountUsd,
                    max: i.max,
                })),
            }),
        );
        return reply.code(r.status).send(r.body);
    });

    app.post("/me/relocks/:id/cancel", auth, async (req, reply) => {
        const { id } = idParam.parse(req.params);
        await cancelRelock(db, { requestId: id, userId: req.user!.id });
        return reply.code(204).send();
    });
}
