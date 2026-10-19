import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
    admins,
    assets,
    auditLogs,
    deposits,
    ledgerEntries,
    ledgerTransactions,
    poolStates,
    userPositions,
    users,
    vaults,
} from "../db/schema.js";

const SHARE_SCALE = 10n ** 18n;
const USD_PER_TOKEN = 1_000_000n; // $1 = 1,000,000 microdollars

export interface ConfirmDepositInput {
    userId: string;
    vaultId: string;
    assetId: string;
    amount: string; // Token's smallest units
    txHash: string;
    transferIndex: number;
    adminId: string;
}

export async function confirmDeposit(input: ConfirmDepositInput) {
    const amount = BigInt(input.amount);

    if (amount <= 0n) {
        throw new Error("Deposit amount must be positive");
    }

    if (!Number.isInteger(input.transferIndex) || input.transferIndex < 0) {
        throw new Error("Invalid transfer index");
    }

    if (!/^0x[a-fA-F0-9]{64}$/.test(input.txHash)) {
        throw new Error("Invalid transaction hash");
    }

    return db.transaction(async (tx) => {
        // Verify the administrator.
        const [admin] = await tx
            .select({ id: admins.id })
            .from(admins)
            .where(and(eq(admins.id, input.adminId), eq(admins.isActive, true)))
            .limit(1);

        if (!admin) {
            throw new Error("Active administrator not found");
        }

        // Verify the user.
        const [user] = await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.id, input.userId), eq(users.isBlocked, false)))
            .limit(1);

        if (!user) {
            throw new Error("Active user not found");
        }

        // Verify vault ownership.
        const [vault] = await tx
            .select({
                id: vaults.id,
                chainId: vaults.chainId,
            })
            .from(vaults)
            .where(
                and(
                    eq(vaults.id, input.vaultId),
                    eq(vaults.userId, input.userId),
                    eq(vaults.isActive, true),
                ),
            )
            .limit(1);

        if (!vault) {
            throw new Error("Active vault not found for this user");
        }

        // Verify the supported token and its chain.
        const [asset] = await tx
            .select({
                id: assets.id,
                chainId: assets.chainId,
                symbol: assets.symbol,
                decimals: assets.decimals,
            })
            .from(assets)
            .where(and(eq(assets.id, input.assetId), eq(assets.isActive, true)))
            .limit(1);

        if (!asset || asset.chainId !== vault.chainId) {
            throw new Error("Asset is not supported on this vault's chain");
        }

        if (!["USDT", "USDC", "DAI"].includes(asset.symbol)) {
            throw new Error("Unsupported stablecoin");
        }

        if (asset.decimals < 0 || asset.decimals > 77) {
            throw new Error("Unsupported token decimals");
        }

        // Convert token base units to microdollars at the fixed $1 peg.
        const tokenScale = 10n ** BigInt(asset.decimals);
        const amountUsd = (amount * USD_PER_TOKEN) / tokenScale;

        if (amountUsd <= 0n) {
            throw new Error(
                "Deposit is too small to represent in microdollars",
            );
        }

        // Ensure the shared pool exists, then lock it.
        await tx
            .insert(poolStates)
            .values({
                singletonKey: 1,
                totalAssetsUsd: "0",
                totalShares: "0",
            })
            .onConflictDoNothing({
                target: poolStates.singletonKey,
            });

        const [poolState] = await tx
            .select()
            .from(poolStates)
            .where(eq(poolStates.singletonKey, 1))
            .for("update");

        if (!poolState) {
            throw new Error("Failed to load shared pool state");
        }

        // Calculate shares. The first deposit establishes the initial share price.
        const poolAssets = BigInt(poolState.totalAssetsUsd);
        const poolShares = BigInt(poolState.totalShares);

        const shares =
            poolShares === 0n
                ? amountUsd * SHARE_SCALE
                : (amountUsd * poolShares) / poolAssets;

        if (shares <= 0n) {
            throw new Error("Deposit would mint zero shares");
        }

        // Ensure the user's position exists, then lock it.
        await tx
            .insert(userPositions)
            .values({ userId: input.userId })
            .onConflictDoNothing({
                target: userPositions.userId,
            });

        const [position] = await tx
            .select()
            .from(userPositions)
            .where(eq(userPositions.userId, input.userId))
            .for("update");

        if (!position) {
            throw new Error("Failed to load user position");
        }

        // Record the confirmed deposit. The unique constraint prevents duplicate
        // asset/transaction/transfer-index combinations.
        const [deposit] = await tx
            .insert(deposits)
            .values({
                userId: input.userId,
                vaultId: input.vaultId,
                assetId: input.assetId,
                amount: amount.toString(),
                amountUsd: amountUsd.toString(),
                txHash: input.txHash.toLowerCase(),
                transferIndex: input.transferIndex,
                confirmedByAdminId: input.adminId,
            })
            .returning();

        // Update the user's position.
        await tx
            .update(userPositions)
            .set({
                assetsUsd: (BigInt(position.assetsUsd) + amountUsd).toString(),
                shares: (BigInt(position.shares) + shares).toString(),
                updatedAt: new Date(),
            })
            .where(eq(userPositions.id, position.id));

        // Update the shared pool.
        await tx
            .update(poolStates)
            .set({
                totalAssetsUsd: (poolAssets + amountUsd).toString(),
                totalShares: (poolShares + shares).toString(),
                updatedAt: new Date(),
            })
            .where(eq(poolStates.id, poolState.id));

        // Create the ledger transaction.
        const [ledgerTransaction] = await tx
            .insert(ledgerTransactions)
            .values({
                type: "deposit",
                referenceType: "deposit",
                referenceId: deposit.id,
                createdByAdminId: input.adminId,
            })
            .returning();

        // Record the incoming token and its USD accounting value.
        await tx.insert(ledgerEntries).values([
            {
                transactionId: ledgerTransaction.id,
                accountType: "pool_assets",
                direction: "debit",
                amountUsd: amountUsd.toString(),
            },
            {
                transactionId: ledgerTransaction.id,
                accountType: "user_liability",
                direction: "credit",
                amountUsd: amountUsd.toString(),
            },
        ]);

        // Record the administrator action.
        await tx.insert(auditLogs).values({
            adminId: input.adminId,
            action: "deposit.confirmed",
            entityType: "deposit",
            entityId: deposit.id,
            details: {
                userId: input.userId,
                vaultId: input.vaultId,
                assetId: input.assetId,
                amount: amount.toString(),
                amountUsd: amountUsd.toString(),
                shares: shares.toString(),
                txHash: input.txHash.toLowerCase(),
                transferIndex: input.transferIndex,
            },
        });

        return {
            depositId: deposit.id,
            amount: amount.toString(),
            amountUsd: amountUsd.toString(),
            sharesMinted: shares.toString(),
        };
    });
}
