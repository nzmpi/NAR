import { and, desc, eq } from "drizzle-orm";
import { config } from "../config.js";
import { assets, auditLogs, chains, users, vaults } from "../db/schema.js";
import { hasRpc } from "../chain/client.js";
import {
    codeAt,
    nativeBalance,
    onchainVault,
    tokenBalance,
} from "../chain/factory.js";
import { getReceiptOrNull } from "../chain/transfers.js";
import { getFactoryAddress, vaultAddressFor } from "../chain/vaultAddress.js";
import { AppError } from "../errors.js";
import type { Database, Tx } from "./types.js";

const MAX_VAULTS_PER_USER = 10;

// One row per chain for each (user, nonce). The address is derived from the
// Factory, keccak(userId, nonce) and the Vault bytecode, so it is the same
// on every chain; rows exist before deployment (counterfactual).
async function provision(
    tx: Tx,
    user: { id: string },
    nonce: number,
    activeChains: { id: string }[],
) {
    const { address } = vaultAddressFor(user.id, nonce);
    for (const c of activeChains)
        await tx
            .insert(vaults)
            .values({
                userId: user.id,
                chainId: c.id,
                nonce,
                address,
                isDeployed: false,
            })
            .onConflictDoNothing();
}

// Default vault (nonce 0) on every active chain, plus any extra vaults an admin
// allowed (also created on chains added later). Idempotent.
export async function ensureVaults(database: Database, userId: string) {
    const [u] = await database
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    if (!u) throw new AppError("User not found", 404, "user_not_found");
    const active = await database
        .select({ id: chains.id })
        .from(chains)
        .where(eq(chains.isActive, true));
    const have = await database
        .select({ nonce: vaults.nonce })
        .from(vaults)
        .where(eq(vaults.userId, userId));
    for (const nonce of new Set<number>([0, ...have.map((r) => r.nonce)]))
        await provision(database, u, nonce, active);
}

// Admin allows one more vault for the user (the default is one).
export function createNextVault(
    database: Database,
    userId: string,
    adminId: string,
) {
    return database.transaction(async (tx) => {
        const [u] = await tx
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .for("update");
        if (!u) throw new AppError("User not found", 404, "user_not_found");
        const active = await tx
            .select({ id: chains.id })
            .from(chains)
            .where(eq(chains.isActive, true));
        const have = await tx
            .select({ nonce: vaults.nonce })
            .from(vaults)
            .where(eq(vaults.userId, userId));

        const next = Math.max(0, ...have.map((r) => r.nonce)) + 1;
        if (next >= MAX_VAULTS_PER_USER)
            throw new AppError(
                "Vault limit reached for this user",
                409,
                "vault_limit",
            );

        await provision(tx, u, 0, active);
        await provision(tx, u, next, active);
        await tx
            .update(users)
            .set({ maxVaults: next + 1, updatedAt: new Date() })
            .where(eq(users.id, userId));
        await tx.insert(auditLogs).values({
            adminId,
            action: "vault.added",
            entityType: "user",
            entityId: userId,
            details: { nonce: next },
        });
        return {
            nonce: next,
            address: vaultAddressFor(u.id, next).address,
        };
    });
}

async function loadVault(database: Database, vaultId: string) {
    const [row] = await database
        .select({
            vault: vaults,
            chainId: chains.chainId,
        })
        .from(vaults)
        .innerJoin(chains, eq(chains.id, vaults.chainId))
        .where(eq(vaults.id, vaultId))
        .limit(1);
    if (!row) throw new AppError("Vault not found", 404, "not_found");
    const { salt, address } = vaultAddressFor(
        row.vault.userId,
        row.vault.nonce,
    );
    // Guards against a changed Factory address or Vault bytecode after rows were created.
    if (address !== row.vault.address.toLowerCase())
        throw new AppError(
            "Stored vault address does not match its derivation; check FACTORY_ADDRESS and the Vault artifact",
            409,
            "derivation_mismatch",
        );
    return { ...row, salt };
}

// True if the vault exists onchain. Throws if the Factory reports another address.
async function deployedOnchain(
    v: Awaited<ReturnType<typeof loadVault>>,
): Promise<boolean> {
    const address = v.vault.address.toLowerCase();
    if (!(await codeAt(v.chainId, address))) return false;
    const reported = await onchainVault(v.chainId, getFactoryAddress(), v.salt);
    if (reported !== address)
        throw new AppError(
            "Factory reports a different vault address; do not use this vault",
            409,
            "vault_mismatch",
        );
    return true;
}

// Refreshes isDeployed from the chain (e.g. after a deployAndTransfer sweep).
export async function syncVaultDeployment(database: Database, vaultId: string) {
    const v = await loadVault(database, vaultId);
    if (!hasRpc(v.chainId))
        return { checked: false, deployed: v.vault.isDeployed };
    const deployed = await deployedOnchain(v);
    if (deployed && !v.vault.isDeployed)
        await database
            .update(vaults)
            .set({ isDeployed: true })
            .where(eq(vaults.id, vaultId));
    return { checked: true, deployed };
}

// Admin confirms the deployment tx. Verified onchain when an RPC is configured.
export async function markVaultDeployed(
    database: Database,
    vaultId: string,
    adminId: string,
    deployTxHash: string,
) {
    const v = await loadVault(database, vaultId);
    if (hasRpc(v.chainId)) {
        const receipt = await getReceiptOrNull(v.chainId, deployTxHash);
        if (!receipt)
            throw new AppError(
                "Transaction not found onchain",
                404,
                "tx_not_found",
            );
        if (receipt.status !== "success")
            throw new AppError("Transaction failed onchain", 400, "tx_failed");
        if (!(await deployedOnchain(v)))
            throw new AppError(
                "No contract at the vault address yet",
                409,
                "not_deployed",
            );
    } else if (config.APP_ENV === "prod") {
        throw new AppError("No RPC configured for this chain", 503, "no_rpc");
    }
    await database
        .update(vaults)
        .set({ isDeployed: true, deployTxHash: deployTxHash.toLowerCase() })
        .where(eq(vaults.id, vaultId));
    await database.insert(auditLogs).values({
        adminId,
        action: "vault.deployed",
        entityType: "vault",
        entityId: vaultId,
        details: { deployTxHash: deployTxHash.toLowerCase() },
    });
}

// Onchain balances of a vault: every active token on its chain, plus native.
export async function getVaultBalances(database: Database, vaultId: string) {
    const v = await loadVault(database, vaultId);
    if (!hasRpc(v.chainId))
        throw new AppError("No RPC configured for this chain", 503, "no_rpc");
    const tokens = await database
        .select()
        .from(assets)
        .where(
            and(eq(assets.chainId, v.vault.chainId), eq(assets.isActive, true)),
        );
    const balances = [];
    for (const t of tokens)
        balances.push({
            assetId: t.id,
            symbol: t.symbol,
            tokenAddress: t.tokenAddress,
            decimals: t.decimals,
            balance: await tokenBalance(
                v.chainId,
                t.tokenAddress,
                v.vault.address,
            ),
        });
    return {
        vaultId,
        address: v.vault.address,
        chainId: v.chainId,
        isDeployed: v.vault.isDeployed,
        balances,
        native: await nativeBalance(v.chainId, v.vault.address),
    };
}

export function listVaultsAdmin(database: Database, userId?: string) {
    return database
        .select({
            id: vaults.id,
            userId: vaults.userId,
            telegramId: users.telegramId,
            username: users.username,
            nonce: vaults.nonce,
            address: vaults.address,
            isDeployed: vaults.isDeployed,
            deployTxHash: vaults.deployTxHash,
            chainUuid: chains.id,
            chainName: chains.name,
            chainId: chains.chainId,
        })
        .from(vaults)
        .innerJoin(users, eq(users.id, vaults.userId))
        .innerJoin(chains, eq(chains.id, vaults.chainId))
        .where(userId ? eq(vaults.userId, userId) : undefined)
        .orderBy(desc(vaults.createdAt))
        .limit(500);
}
