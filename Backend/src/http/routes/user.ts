import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { admins } from "../../db/schema.js";
import { accessEnv, requireTelegram, requireUser } from "../auth.js";
import { accessStatus, requestAccess } from "../../services/accessRequests.js";
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
import { ensureVaults } from "../../services/vaults.js";
import { AppError } from "../../errors.js";
import { userLimit } from "../limits.js";
import { config } from "../../config.js";

// The Factory contract is never a payout destination (the route knows the config).
const notFactory = (addr: string) => {
    if (addr.toLowerCase() === config.FACTORY_ADDRESS?.toLowerCase())
        throw new AppError("Payout address is not allowed", 400, "bad_address");
};

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
    const auth = { preHandler: [requireUser, userLimit("read", 120)] };
    const write = { preHandler: [requireUser, userLimit("write", 20)] };
    const chain = { preHandler: [requireUser, userLimit("chain", 6)] }; // RPC-hitting

    // Reachable without access: the mock Mini App shows the status and lets
    // the user ask for approval (the bot offers the same button).
    const tgRead = { preHandler: [requireTelegram, userLimit("read", 120)] };
    const tgWrite = { preHandler: [requireTelegram, userLimit("access", 5)] };
    app.get("/me/access", tgRead, async (req) =>
        accessStatus(db, accessEnv, req.tg!.telegramId),
    );
    app.post("/me/access-request", tgWrite, async (req) =>
        requestAccess(db, accessEnv, req.tg!),
    );

    // isAdmin unlocks the manager pool in the deposit form; the deposit
    // service checks the same thing again.
    app.get("/me", auth, async (req) => {
        const [adm] = await db
            .select({ id: admins.id })
            .from(admins)
            .where(
                and(
                    eq(admins.telegramId, req.user!.telegramId),
                    eq(admins.isActive, true),
                ),
            )
            .limit(1);
        return { ...req.user, isAdmin: !!adm };
    });
    app.get("/assets", auth, async () => listAssets(db));
    app.get("/me/vaults", auth, async (req) => {
        await ensureVaults(db, req.user!.id);
        return listUserVaults(db, req.user!.id);
    });
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

    app.post("/me/deposits/intents", write, async (req, reply) => {
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

    app.post("/me/deposits/intents/:id/cancel", write, async (req, reply) => {
        const { id } = idParam.parse(req.params);
        await cancelIntent(db, id, req.user!.id);
        return reply.code(204).send();
    });

    app.post(
        "/me/deposits/intents/:id/approve-amount",
        write,
        async (req, reply) => {
            const { id } = idParam.parse(req.params);
            await approveAmount(db, { intentId: id, userId: req.user!.id });
            return reply.code(204).send();
        },
    );

    app.post("/me/deposits/intents/:id/check", chain, async (req) => {
        const { id } = idParam.parse(req.params);
        return checkIntent(db, id, req.user!.id);
    });

    app.post("/me/deposits/intents/:id/tx-hash", chain, async (req) => {
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

    app.post("/me/withdrawals/preview", write, async (req) => {
        const b = withdrawalBody.parse(req.body);
        notFactory(b.destinationAddress);
        return previewWithdrawal(db, { userId: req.user!.id, ...b });
    });

    app.post("/me/withdrawals", write, async (req, reply) => {
        const b = withdrawalBody.parse(req.body);
        notFactory(b.destinationAddress);
        const r = await idempotent(req, req.user!.id, 201, () =>
            requestWithdrawal(db, { userId: req.user!.id, ...b }),
        );
        return reply.code(r.status).send(r.body);
    });

    app.post("/me/withdrawals/:id/cancel", write, async (req, reply) => {
        const { id } = idParam.parse(req.params);
        await cancelWithdrawal(db, { withdrawalId: id, userId: req.user!.id });
        return reply.code(204).send();
    });

    /* relocks (queued until the next settlement) */
    app.get("/me/relocks", auth, async (req) =>
        listUserRelocks(db, req.user!.id),
    );

    app.post("/me/relocks", write, async (req, reply) => {
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

    app.post("/me/relocks/:id/cancel", write, async (req, reply) => {
        const { id } = idParam.parse(req.params);
        await cancelRelock(db, { requestId: id, userId: req.user!.id });
        return reply.code(204).send();
    });
}
