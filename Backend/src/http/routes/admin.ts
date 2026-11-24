import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import {
    assets,
    auditLogs,
    chains,
    depositIntents,
    userAllowlist,
    users,
    withdrawals,
} from "../../db/schema.js";
import { requireAdmin } from "../auth.js";
import {
    decideAccessRequest,
    listAccessRequests,
} from "../../services/accessRequests.js";
import type { Database } from "../../services/types.js";
import { hasRpc } from "../../chain/client.js";
import { idempotent } from "../idempotency.js";
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
    scanChain,
    verifySweepTx,
} from "../../services/transferScanner.js";
import { settleManual } from "../../services/settlement.js";
import {
    lockWithdrawal,
    markWithdrawalPaid,
    rejectWithdrawal,
} from "../../services/withdrawals.js";
import { fmtUsd, notifyUser } from "../../services/notify.js";
import {
    adminListAudit,
    adminListDeposits,
    adminListSettlements,
    adminListTransfers,
    adminListUsers,
    adminListRelocks,
    adminListWithdrawals,
    adminPools,
    getPortfolio,
} from "../../services/queries.js";
import { AppError } from "../../errors.js";
import { adminPerformance } from "../../services/history.js";
import {
    createNextVault,
    getVaultBalances,
    listVaultsAdmin,
    markVaultDeployed,
    syncVaultDeployment,
} from "../../services/vaults.js";
import {
    buildDeployBatch,
    buildSweepBatch,
} from "../../services/safeCalldata.js";

// Lists show the newest `limit` rows; the Admin "Show more" raises it.
const statusQuery = z.object({
    status: z.string().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
});

// Pass the transaction the change runs in, so the change and its log commit together.
async function audit(
    exec: Database,
    adminId: string,
    action: string,
    entityType: string,
    entityId: string,
    details: unknown,
) {
    await exec.insert(auditLogs).values({
        adminId,
        action,
        entityType,
        entityId,
        details: details as object,
    });
}

// State-changing admin calls need an Idempotency-Key: a double-submit replays
// the first response instead of acting twice.
const once =
    (status: number, run: (req: FastifyRequest) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
        const r = await idempotent(req, req.admin!.id, status, () => run(req));
        return reply.code(r.status).send(r.body);
    };

export async function adminRoutes(app: FastifyInstance) {
    const auth = { preHandler: requireAdmin };

    /* overview */
    app.get("/admin/pools", auth, async () => adminPools(db));
    app.get("/admin/users", auth, async (req) =>
        adminListUsers(
            db,
            statusQuery.pick({ limit: true }).parse(req.query).limit,
        ),
    );
    app.get("/admin/performance", auth, async (req) => {
        const q = z
            .object({
                range: z.enum(["1w", "1m", "3m", "1y", "all"]).default("1m"),
            })
            .parse(req.query);
        return adminPerformance(db, q.range);
    });

    /* settlement: operator enters current total USD value of ALL managed funds */
    app.post(
        "/admin/settlements",
        auth,
        once(200, async (req) => {
            const b = z
                .object({
                    reportedTotalUsd: big,
                    bonuses: z
                        .array(z.object({ lotId: uuid, amountUsd: big }))
                        .max(100)
                        .optional(),
                    note: z.string().max(500).optional(),
                    confirmLargeMove: z.boolean().optional(),
                })
                .parse(req.body);
            const r = await settleManual(db, { adminId: req.admin!.id, ...b });
            return {
                settlementId: r.settlementId,
                pnlUsd: r.pnlUsd,
                convertedLots: r.convertedLots,
            };
        }),
    );

    /* deposits */
    app.get("/admin/deposits", auth, async (req) => {
        const q = statusQuery.parse(req.query);
        return adminListDeposits(db, q.status, q.limit);
    });
    app.get("/admin/transfers", auth, async (req) => {
        const q = z
            .object({ unmatched: z.enum(["true", "false"]).optional() })
            .parse(req.query);
        return adminListTransfers(db, q.unmatched === "true");
    });

    // Reads every vault's token balances; only funded vaults get a log scan.
    app.post(
        "/admin/scan",
        auth,
        once(200, async (req) => {
            const active = await db
                .select()
                .from(chains)
                .where(eq(chains.isActive, true));
            const out = [];
            for (const c of active) {
                if (!hasRpc(c.chainId)) {
                    out.push({ chain: c.name, error: "no RPC" });
                    continue;
                }
                try {
                    const r = await scanChain(db, {
                        id: c.id,
                        chainId: c.chainId,
                    });
                    out.push({ chain: c.name, ...r });
                } catch (e) {
                    req.log.error(e);
                    out.push({ chain: c.name, error: "RPC error" });
                }
            }
            return { chains: out };
        }),
    );

    app.post(
        "/admin/transfers",
        auth,
        once(201, async (req) => {
            const b = z
                .object({
                    chainId: uuid,
                    txHash,
                    logIndex: z.number().int().nonnegative().optional(),
                })
                .parse(req.body);
            return db.transaction(async (tx) => {
                const rows = await ingestTransactionByHash(
                    tx,
                    b.chainId,
                    b.txHash,
                    b.logIndex,
                );
                await audit(
                    tx,
                    req.admin!.id,
                    "transfer.ingested",
                    "chain",
                    b.chainId,
                    {
                        txHash: b.txHash,
                        count: rows.length,
                    },
                );
                return { transfers: rows };
            });
        }),
    );

    app.post(
        "/admin/transfers/:id/match",
        auth,
        once(204, async (req) => {
            const { id } = idParam.parse(req.params);
            const b = z.object({ intentId: uuid }).parse(req.body);
            await db.transaction(async (tx) => {
                await matchTransfer(tx, id, b.intentId);
                await audit(
                    tx,
                    req.admin!.id,
                    "transfer.matched",
                    "deposit_transfer",
                    id,
                    b,
                );
            });
            return null;
        }),
    );

    app.post(
        "/admin/deposits/:id/sweep",
        auth,
        once(200, async (req) => {
            const { id } = idParam.parse(req.params);
            const b = z
                .object({
                    sweepTxHash: txHash,
                    confirmedAmount: big.optional(),
                })
                .parse(req.body);
            await reverifyIntentTransfers(db, id);
            const sweptAmount = await verifySweepTx(db, id, b.sweepTxHash);
            const [iv] = await db
                .select({ vaultId: depositIntents.vaultId })
                .from(depositIntents)
                .where(eq(depositIntents.id, id));
            if (iv) await syncVaultDeployment(db, iv.vaultId);
            const r = await recordSweep(db, {
                intentId: id,
                adminId: req.admin!.id,
                sweptAmount,
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
        }),
    );

    app.post(
        "/admin/deposits/:id/reject",
        auth,
        once(204, async (req) => {
            const { id } = idParam.parse(req.params);
            const b = z
                .object({ reason: z.string().min(1).max(500) })
                .parse(req.body);
            await rejectIntent(db, {
                intentId: id,
                adminId: req.admin!.id,
                reason: b.reason,
            });
            return null;
        }),
    );

    app.post(
        "/admin/deposits/:id/activate",
        auth,
        once(200, async (req) => {
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
        }),
    );

    /* withdrawals */
    app.get("/admin/withdrawals", auth, async (req) => {
        const q = statusQuery.parse(req.query);
        return adminListWithdrawals(db, q.status, q.limit);
    });

    // Read only: relocks apply on their own at the next settlement.
    app.get("/admin/relocks", auth, async (req) => {
        const q = statusQuery.parse(req.query);
        return adminListRelocks(db, q.status, q.limit);
    });

    app.post(
        "/admin/withdrawals/:id/lock",
        auth,
        once(204, async (req) => {
            const { id } = idParam.parse(req.params);
            await lockWithdrawal(db, {
                withdrawalId: id,
                adminId: req.admin!.id,
            });
            return null;
        }),
    );

    app.post(
        "/admin/withdrawals/:id/reject",
        auth,
        once(204, async (req) => {
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
            return null;
        }),
    );

    app.post(
        "/admin/withdrawals/:id/paid",
        auth,
        once(200, async (req) => {
            const { id } = idParam.parse(req.params);
            const b = z
                .object({
                    txHash,
                    reportedTotalUsd: big,
                })
                .parse(req.body);
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
        }),
    );

    /* configuration: chains, assets, vaults */
    app.post(
        "/admin/chains",
        auth,
        once(201, async (req) => {
            const b = z
                .object({
                    name: z.string().min(1).max(40),
                    chainId: z.number().int().positive(),
                })
                .parse(req.body);
            return db.transaction(async (tx) => {
                const [c] = await tx.insert(chains).values(b).returning();
                await audit(
                    tx,
                    req.admin!.id,
                    "chain.created",
                    "chain",
                    c.id,
                    b,
                );
                return c;
            });
        }),
    );

    app.post(
        "/admin/assets",
        auth,
        once(201, async (req) => {
            const b = z
                .object({
                    chainId: uuid,
                    symbol: z.enum(["USDT", "USDC", "DAI"]),
                    name: z.string().min(1).max(60),
                    tokenAddress: evmAddress,
                    decimals: z.number().int().min(0).max(36),
                })
                .parse(req.body);
            return db.transaction(async (tx) => {
                const [a] = await tx
                    .insert(assets)
                    .values({
                        ...b,
                        tokenAddress: b.tokenAddress.toLowerCase(),
                    })
                    .returning();
                await audit(
                    tx,
                    req.admin!.id,
                    "asset.created",
                    "asset",
                    a.id,
                    b,
                );
                return a;
            });
        }),
    );

    app.post(
        "/admin/assets/:id/active",
        auth,
        once(204, async (req) => {
            const { id } = idParam.parse(req.params);
            const b = z.object({ isActive: z.boolean() }).parse(req.body);
            await db.transaction(async (tx) => {
                const r = await tx
                    .update(assets)
                    .set({ isActive: b.isActive })
                    .where(eq(assets.id, id))
                    .returning({ id: assets.id });
                if (!r.length)
                    throw new AppError("Asset not found", 404, "not_found");
                await audit(
                    tx,
                    req.admin!.id,
                    "asset.active_changed",
                    "asset",
                    id,
                    b,
                );
            });
            return null;
        }),
    );

    // Registers a user's (counterfactual) vault address. Address derivation
    // from Factory + salt is not automated yet.
    app.get("/admin/vaults", auth, async (req) => {
        const q = z.object({ userId: uuid.optional() }).parse(req.query);
        return listVaultsAdmin(db, q.userId);
    });

    app.post(
        "/admin/users/:id/vaults",
        auth,
        once(201, async (req) => {
            const { id } = idParam.parse(req.params);
            return await createNextVault(db, id, req.admin!.id);
        }),
    );

    app.post(
        "/admin/vaults/:id/deployed",
        auth,
        once(204, async (req) => {
            const { id } = idParam.parse(req.params);
            const b = z.object({ deployTxHash: txHash }).parse(req.body);
            await markVaultDeployed(db, id, req.admin!.id, b.deployTxHash);
            return null;
        }),
    );

    app.get("/admin/vaults/:id/balances", auth, async (req) => {
        const { id } = idParam.parse(req.params);
        return getVaultBalances(db, id);
    });

    app.post("/admin/vaults/deploy-calldata", auth, async (req) => {
        const b = z
            .object({ vaultIds: z.array(uuid).min(1).max(50) })
            .parse(req.body);
        return buildDeployBatch(db, b.vaultIds);
    });

    app.post("/admin/vaults/:id/sweep-calldata", auth, async (req) => {
        const { id } = idParam.parse(req.params);
        const b = z
            .object({
                to: evmAddress,
                items: z
                    .array(
                        z.object({
                            assetId: uuid,
                            amount: z.union([big, z.literal("max")]),
                        }),
                    )
                    .max(10)
                    .default([]),
                includeNative: z.boolean().default(false),
            })
            .parse(req.body);
        return buildSweepBatch(db, { vaultId: id, ...b });
    });

    app.get("/admin/assets", auth, async () =>
        db
            .select({
                id: assets.id,
                symbol: assets.symbol,
                name: assets.name,
                tokenAddress: assets.tokenAddress,
                decimals: assets.decimals,
                isActive: assets.isActive,
                chainUuid: chains.id,
                chainName: chains.name,
                chainId: chains.chainId,
            })
            .from(assets)
            .innerJoin(chains, eq(chains.id, assets.chainId)),
    );

    app.get("/admin/users/:id/portfolio", auth, async (req) => {
        const { id } = idParam.parse(req.params);
        return getPortfolio(db, id);
    });

    app.post(
        "/admin/users/:id/blocked",
        auth,
        once(204, async (req) => {
            const { id } = idParam.parse(req.params);
            const b = z.object({ isBlocked: z.boolean() }).parse(req.body);
            await db.transaction(async (tx) => {
                const r = await tx
                    .update(users)
                    .set({ isBlocked: b.isBlocked, updatedAt: new Date() })
                    .where(eq(users.id, id))
                    .returning({ id: users.id });
                if (!r.length)
                    throw new AppError("User not found", 404, "not_found");
                await audit(
                    tx,
                    req.admin!.id,
                    b.isBlocked ? "user.blocked" : "user.unblocked",
                    "user",
                    id,
                    b,
                );
            });
            return null;
        }),
    );

    /* sign-up allowlist (enforced in prod) */
    const tgId = z.string().regex(/^[0-9]{1,20}$/);
    app.get("/admin/allowlist", auth, async () =>
        db.select().from(userAllowlist).orderBy(desc(userAllowlist.createdAt)),
    );

    app.post(
        "/admin/allowlist",
        auth,
        once(204, async (req) => {
            const b = z
                .object({
                    telegramId: tgId,
                    note: z.string().trim().max(100).optional(),
                })
                .parse(req.body);
            await db.transaction(async (tx) => {
                const r = await tx
                    .insert(userAllowlist)
                    .values({ ...b, addedBy: req.admin!.id })
                    .onConflictDoNothing()
                    .returning();
                if (r.length)
                    await audit(
                        tx,
                        req.admin!.id,
                        "allowlist.added",
                        "user_allowlist",
                        b.telegramId,
                        b,
                    );
            });
            return null;
        }),
    );

    app.post(
        "/admin/allowlist/:telegramId/remove",
        auth,
        once(204, async (req) => {
            const { telegramId } = z
                .object({ telegramId: tgId })
                .parse(req.params);
            await db.transaction(async (tx) => {
                const r = await tx
                    .delete(userAllowlist)
                    .where(eq(userAllowlist.telegramId, telegramId))
                    .returning({ id: userAllowlist.telegramId });
                if (r.length)
                    await audit(
                        tx,
                        req.admin!.id,
                        "allowlist.removed",
                        "user_allowlist",
                        telegramId,
                        {},
                    );
            });
            return null;
        }),
    );

    /* access requests from people not on the allowlist */
    app.get("/admin/access-requests", auth, async (req) => {
        const q = statusQuery.parse(req.query);
        return listAccessRequests(db, q.status, q.limit);
    });
    for (const [action, approve] of [
        ["approve", true],
        ["reject", false],
    ] as const)
        app.post(
            `/admin/access-requests/:telegramId/${action}`,
            auth,
            once(204, async (req) => {
                const { telegramId } = z
                    .object({ telegramId: tgId })
                    .parse(req.params);
                await decideAccessRequest(db, {
                    telegramId,
                    adminId: req.admin!.id,
                    approve,
                });
                return null;
            }),
        );

    app.get("/admin/chains", auth, async () =>
        db
            .select({
                id: chains.id,
                name: chains.name,
                chainId: chains.chainId,
                isActive: chains.isActive,
            })
            .from(chains),
    );

    app.get("/admin/settlements", auth, async (req) => {
        const q = z
            .object({ all: z.enum(["true", "false"]).optional() })
            .parse(req.query);
        return adminListSettlements(db, q.all !== "true");
    });

    app.get("/admin/audit", auth, async () => adminListAudit(db));
}
