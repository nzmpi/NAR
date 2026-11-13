import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import {
    assets,
    auditLogs,
    chains,
    depositIntents,
    vaults,
    withdrawals,
} from "../../db/schema.js";
import { requireAdmin } from "../auth.js";
import { big, evmAddress, idParam, txHash, uuid } from "../schemas.js";
import {
    activateDeposit,
    matchTransfer,
    recordSweep,
    rejectIntent,
} from "../../services/depositIntents.js";
import {
    ingestTransactionByHash,
    reverifyIntentTransfers,
    verifySweepTx,
} from "../../services/transferScanner.js";
import { settleManual } from "../../services/settlement.js";
import {
    markWithdrawalPaid,
    rejectWithdrawal,
} from "../../services/withdrawals.js";
import { fmtUsd, notifyUser } from "../../services/notify.js";
import {
    adminListDeposits,
    adminListTransfers,
    adminListUsers,
    adminListWithdrawals,
    adminPools,
} from "../../services/queries.js";
import { AppError } from "../../errors.js";
import { adminPerformance } from "../../services/history.js";

const statusQuery = z.object({ status: z.string().max(40).optional() });

async function audit(
    adminId: string,
    action: string,
    entityType: string,
    entityId: string,
    details: unknown,
) {
    await db.insert(auditLogs).values({
        adminId,
        action,
        entityType,
        entityId,
        details: details as object,
    });
}

export async function adminRoutes(app: FastifyInstance) {
    const auth = { preHandler: requireAdmin };

    /* overview */
    app.get("/admin/pools", auth, async () => adminPools(db));
    app.get("/admin/users", auth, async () => adminListUsers(db));
    app.get("/admin/performance", auth, async (req) => {
        const q = z
            .object({
                range: z.enum(["1w", "1m", "3m", "1y", "all"]).default("1m"),
            })
            .parse(req.query);
        return adminPerformance(db, q.range);
    });

    /* settlement: operator enters current total USD value of ALL managed funds */
    app.post("/admin/settlements", auth, async (req) => {
        const b = z
            .object({
                reportedTotalUsd: big,
                bonuses: z
                    .array(z.object({ lotId: uuid, amountUsd: big }))
                    .max(100)
                    .optional(),
                note: z.string().max(500).optional(),
            })
            .parse(req.body);
        const r = await settleManual(db, { adminId: req.admin!.id, ...b });
        return {
            settlementId: r.settlementId,
            pnlUsd: r.pnlUsd,
            convertedLots: r.convertedLots,
        };
    });

    /* deposits */
    app.get("/admin/deposits", auth, async (req) =>
        adminListDeposits(db, statusQuery.parse(req.query).status),
    );
    app.get("/admin/transfers", auth, async (req) => {
        const q = z
            .object({ unmatched: z.enum(["true", "false"]).optional() })
            .parse(req.query);
        return adminListTransfers(db, q.unmatched === "true");
    });

    app.post("/admin/transfers", auth, async (req, reply) => {
        const b = z
            .object({
                chainId: uuid,
                txHash,
                logIndex: z.number().int().nonnegative().optional(),
            })
            .parse(req.body);
        const rows = await ingestTransactionByHash(
            db,
            b.chainId,
            b.txHash,
            b.logIndex,
        );
        await audit(req.admin!.id, "transfer.ingested", "chain", b.chainId, {
            txHash: b.txHash,
            count: rows.length,
        });
        return reply.code(201).send({ transfers: rows });
    });

    app.post("/admin/transfers/:id/match", auth, async (req, reply) => {
        const { id } = idParam.parse(req.params);
        const b = z.object({ intentId: uuid }).parse(req.body);
        await matchTransfer(db, id, b.intentId);
        await audit(
            req.admin!.id,
            "transfer.matched",
            "deposit_transfer",
            id,
            b,
        );
        return reply.code(204).send();
    });

    app.post("/admin/deposits/:id/sweep", auth, async (req) => {
        const { id } = idParam.parse(req.params);
        const b = z
            .object({ sweepTxHash: txHash, confirmedAmount: big.optional() })
            .parse(req.body);
        await reverifyIntentTransfers(db, id);
        await verifySweepTx(db, id, b.sweepTxHash);
        const r = await recordSweep(db, {
            intentId: id,
            adminId: req.admin!.id,
            ...b,
        });
        if (r.status === "awaiting_user_approval") {
            const [i] = await db
                .select({ userId: depositIntents.userId })
                .from(depositIntents)
                .where(eq(depositIntents.id, id));
            if (i)
                void notifyUser(
                    i.userId,
                    `Your deposit arrived with a different amount (${fmtUsd(r.confirmedAmountUsd)} USD). Open the app to review and approve it.`,
                    req.log,
                );
        }
        return r;
    });

    app.post("/admin/deposits/:id/reject", auth, async (req, reply) => {
        const { id } = idParam.parse(req.params);
        const b = z
            .object({ reason: z.string().min(1).max(500) })
            .parse(req.body);
        await rejectIntent(db, {
            intentId: id,
            adminId: req.admin!.id,
            reason: b.reason,
        });
        return reply.code(204).send();
    });

    app.post("/admin/deposits/:id/activate", auth, async (req) => {
        const { id } = idParam.parse(req.params);
        const b = z.object({ reportedTotalUsd: big }).parse(req.body);
        const [i] = await db
            .select({ userId: depositIntents.userId })
            .from(depositIntents)
            .where(eq(depositIntents.id, id));
        await reverifyIntentTransfers(db, id);
        const r = await activateDeposit(db, {
            intentId: id,
            adminId: req.admin!.id,
            reportedTotalUsd: b.reportedTotalUsd,
        });
        if (i)
            void notifyUser(
                i.userId,
                `Deposit confirmed: ${fmtUsd(r.amountUsd)} USD is now active.`,
                req.log,
            );
        return r;
    });

    /* withdrawals */
    app.get("/admin/withdrawals", auth, async (req) =>
        adminListWithdrawals(db, statusQuery.parse(req.query).status),
    );

    app.post("/admin/withdrawals/:id/reject", auth, async (req, reply) => {
        const { id } = idParam.parse(req.params);
        const b = z
            .object({ reason: z.string().min(1).max(500) })
            .parse(req.body);
        await rejectWithdrawal(db, {
            withdrawalId: id,
            adminId: req.admin!.id,
            reason: b.reason,
        });
        const [w] = await db
            .select({ userId: withdrawals.userId })
            .from(withdrawals)
            .where(eq(withdrawals.id, id));
        if (w)
            void notifyUser(
                w.userId,
                `Your withdrawal request was rejected: ${b.reason}`,
                req.log,
            );
        return reply.code(204).send();
    });

    app.post("/admin/withdrawals/:id/paid", auth, async (req) => {
        const { id } = idParam.parse(req.params);
        const b = z.object({ txHash, reportedTotalUsd: big }).parse(req.body);
        const [w] = await db
            .select({ userId: withdrawals.userId })
            .from(withdrawals)
            .where(eq(withdrawals.id, id));
        const r = await markWithdrawalPaid(db, {
            withdrawalId: id,
            adminId: req.admin!.id,
            txHash: b.txHash,
            reportedTotalUsd: b.reportedTotalUsd,
        });
        if (w)
            void notifyUser(
                w.userId,
                `Withdrawal paid: ${fmtUsd(r.netUsd)} USD sent.`,
                req.log,
            );
        return r;
    });

    /* configuration: chains, assets, vaults */
    app.post("/admin/chains", auth, async (req, reply) => {
        const b = z
            .object({
                name: z.string().min(1).max(40),
                chainId: z.number().int().positive(),
            })
            .parse(req.body);
        const [c] = await db.insert(chains).values(b).returning();
        await audit(req.admin!.id, "chain.created", "chain", c.id, b);
        return reply.code(201).send(c);
    });

    app.post("/admin/assets", auth, async (req, reply) => {
        const b = z
            .object({
                chainId: uuid,
                symbol: z.enum(["USDT", "USDC", "DAI"]),
                name: z.string().min(1).max(60),
                tokenAddress: evmAddress,
                decimals: z.number().int().min(0).max(36),
            })
            .parse(req.body);
        const [a] = await db
            .insert(assets)
            .values({ ...b, tokenAddress: b.tokenAddress.toLowerCase() })
            .returning();
        await audit(req.admin!.id, "asset.created", "asset", a.id, b);
        return reply.code(201).send(a);
    });

    app.post("/admin/assets/:id/active", auth, async (req, reply) => {
        const { id } = idParam.parse(req.params);
        const b = z.object({ isActive: z.boolean() }).parse(req.body);
        const r = await db
            .update(assets)
            .set({ isActive: b.isActive })
            .where(eq(assets.id, id))
            .returning({ id: assets.id });
        if (!r.length) throw new AppError("Asset not found", 404, "not_found");
        await audit(req.admin!.id, "asset.active_changed", "asset", id, b);
        return reply.code(204).send();
    });

    // Registers a user's (counterfactual) vault address. Address derivation
    // from Factory + salt is not automated yet.
    app.post("/admin/vaults", auth, async (req, reply) => {
        const b = z
            .object({
                userId: uuid,
                chainId: uuid,
                nonce: z.number().int().nonnegative().default(0),
                address: evmAddress,
            })
            .parse(req.body);
        const [v] = await db
            .insert(vaults)
            .values({ ...b, address: b.address.toLowerCase() })
            .returning();
        await audit(req.admin!.id, "vault.registered", "vault", v.id, b);
        return reply.code(201).send(v);
    });

    app.post("/admin/vaults/:id/deployed", auth, async (req, reply) => {
        const { id } = idParam.parse(req.params);
        const b = z.object({ deployTxHash: txHash }).parse(req.body);
        const r = await db
            .update(vaults)
            .set({
                isDeployed: true,
                deployTxHash: b.deployTxHash.toLowerCase(),
            })
            .where(eq(vaults.id, id))
            .returning({ id: vaults.id });
        if (!r.length) throw new AppError("Vault not found", 404, "not_found");
        await audit(req.admin!.id, "vault.deployed", "vault", id, b);
        return reply.code(204).send();
    });
}
