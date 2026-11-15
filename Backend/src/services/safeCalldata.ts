import { and, eq, inArray } from "drizzle-orm";
import { isAddress, type Address } from "viem";
import { assets, chains, vaults } from "../db/schema.js";
import { hasRpc } from "../chain/client.js";
import {
    encodeDeploy,
    encodeDeployAndTransfer,
    encodeTransfer,
    encodeTransferNative,
    tokenBalance,
} from "../chain/factory.js";
import {
    computeVaultAddress,
    getFactoryAddress,
    vaultSalt,
} from "../chain/vaultAddress.js";
import { AppError } from "../errors.js";
import type { Database } from "./types.js";

export interface SafeTx {
    to: string;
    value: string;
    data: string;
    description: string;
}

// Format of the Safe "Transaction Builder" batch import.
function safeBatch(chainId: number, name: string, txs: SafeTx[]) {
    return {
        version: "1.0",
        chainId: String(chainId),
        createdAt: Date.now(),
        meta: { name, description: "", txBuilderVersion: "1.17.0" },
        transactions: txs.map((t) => ({
            to: t.to,
            value: t.value,
            data: t.data,
            contractMethod: null,
            contractInputsValues: null,
        })),
    };
}

async function loadVaults(database: Database, ids: string[]) {
    const rows = await database
        .select({
            vault: vaults,
            chainId: chains.chainId,
        })
        .from(vaults)
        .innerJoin(chains, eq(chains.id, vaults.chainId))
        .where(inArray(vaults.id, ids));
    if (rows.length !== new Set(ids).size)
        throw new AppError("Vault not found", 404, "not_found");
    for (const r of rows) {
        const salt = vaultSalt(r.vault.userId, r.vault.nonce);
        // Never produce calldata for an address that does not match the derivation.
        if (
            computeVaultAddress(salt).toLowerCase() !==
            r.vault.address.toLowerCase()
        )
            throw new AppError(
                "Stored vault address does not match its derivation",
                409,
                "derivation_mismatch",
            );
    }
    return rows.map((r) => ({
        ...r,
        salt: vaultSalt(r.vault.userId, r.vault.nonce),
    }));
}

// Factory.deploy(salt) for undeployed vaults of one chain.
export async function buildDeployBatch(database: Database, vaultIds: string[]) {
    const rows = await loadVaults(database, vaultIds);
    const chainId = rows[0].chainId;
    if (rows.some((r) => r.chainId !== chainId))
        throw new AppError(
            "All vaults must be on the same chain",
            400,
            "bad_request",
        );
    if (rows.some((r) => r.vault.isDeployed))
        throw new AppError(
            "A selected vault is already deployed",
            409,
            "bad_state",
        );

    const factory = getFactoryAddress();
    const txs: SafeTx[] = rows.map((r) => ({
        to: factory,
        value: "0",
        data: encodeDeploy(r.salt),
        description: `Deploy vault ${r.vault.address}`,
    }));
    return {
        chainId,
        transactions: txs,
        safeBatch: safeBatch(chainId, "Deploy vaults", txs),
    };
}

export interface SweepItem {
    assetId: string;
    amount: bigint | "max";
}

// Sweep tokens (and optionally native) from one vault to a destination the
// operator supplies. Undeployed vaults are deployed in the same batch.
export async function buildSweepBatch(
    database: Database,
    i: {
        vaultId: string;
        to: string;
        items: SweepItem[];
        includeNative: boolean;
    },
) {
    const [r] = await loadVaults(database, [i.vaultId]);
    const factory = getFactoryAddress();

    if (!isAddress(i.to))
        throw new AppError("Invalid destination address", 400, "bad_address");
    const to = i.to as Address;
    const lower = to.toLowerCase();
    if (
        /^0x0{40}$/.test(lower) ||
        lower === r.vault.address.toLowerCase() ||
        lower === factory.toLowerCase()
    )
        throw new AppError(
            "Destination address is not allowed",
            400,
            "bad_address",
        );

    const tokens: Address[] = [];
    const amounts: bigint[] = [];
    for (const item of i.items) {
        const [a] = await database
            .select()
            .from(assets)
            .where(
                and(
                    eq(assets.id, item.assetId),
                    eq(assets.chainId, r.vault.chainId),
                    eq(assets.isActive, true),
                ),
            )
            .limit(1);
        if (!a)
            throw new AppError(
                "Asset is not active on the vault's chain",
                400,
                "bad_asset",
            );
        let amount: bigint;
        if (item.amount === "max") {
            if (!hasRpc(r.chainId))
                throw new AppError(
                    "No RPC configured to read the balance",
                    503,
                    "no_rpc",
                );
            amount = await tokenBalance(
                r.chainId,
                a.tokenAddress,
                r.vault.address,
            );
        } else {
            amount = item.amount;
        }
        if (amount <= 0n) continue;
        tokens.push(a.tokenAddress as Address);
        amounts.push(amount);
    }
    if (!tokens.length && !i.includeNative)
        throw new AppError("Nothing to sweep", 400, "nothing_to_sweep");

    const vault = r.vault.address as Address;
    const txs: SafeTx[] = [];
    if (!r.vault.isDeployed) {
        txs.push(
            tokens.length
                ? {
                      to: factory,
                      value: "0",
                      data: encodeDeployAndTransfer(
                          r.salt,
                          to,
                          tokens,
                          amounts,
                      ),
                      description: `Deploy vault ${vault} and sweep tokens to ${to}`,
                  }
                : {
                      to: factory,
                      value: "0",
                      data: encodeDeploy(r.salt),
                      description: `Deploy vault ${vault}`,
                  },
        );
    } else if (tokens.length) {
        txs.push({
            to: factory,
            value: "0",
            data: encodeTransfer(vault, to, tokens, amounts),
            description: `Sweep tokens from ${vault} to ${to}`,
        });
    }
    if (i.includeNative)
        txs.push({
            to: factory,
            value: "0",
            data: encodeTransferNative(vault, to),
            description: `Sweep native balance from ${vault} to ${to}`,
        });

    return {
        chainId: r.chainId,
        vault,
        destination: to,
        tokens,
        amounts,
        transactions: txs,
        safeBatch: safeBatch(r.chainId, "Sweep vault", txs),
    };
}
