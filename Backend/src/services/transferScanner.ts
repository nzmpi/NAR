import { and, eq, inArray } from "drizzle-orm";
import {
    assets,
    chainScanState,
    chains,
    depositIntents,
    depositTransfers,
    vaults,
} from "../db/schema.js";
import { config } from "../config.js";
import { getClient, hasRpc } from "../chain/client.js";
import { erc20Abi, type Address } from "viem";
import {
    getBlockTimestamp,
    getHead,
    getReceiptOrNull,
    getTransfersInRange,
    getTransfersInTx,
    type ChainTransfer,
} from "../chain/transfers.js";
import { AppError } from "../errors.js";
import { autoMatchTransfer, matchTransfer } from "./depositIntents.js";
import type { Database } from "./types.js";

interface ChainRow {
    id: string;
    chainId: number;
}

/* ----------------------------- ingest ----------------------------- */

// Stores verified onchain transfers into known vaults of configured tokens.
// Idempotent on chain + tx hash + log index. Never credits anything.
async function ingest(
    database: Database,
    chain: ChainRow,
    transfers: ChainTransfer[],
) {
    if (!transfers.length) return [] as { id: string; created: boolean }[];
    const vs = await database
        .select({ id: vaults.id, address: vaults.address })
        .from(vaults)
        .where(and(eq(vaults.chainId, chain.id), eq(vaults.isActive, true)));
    const toks = await database
        .select({ id: assets.id, tokenAddress: assets.tokenAddress })
        .from(assets)
        .where(and(eq(assets.chainId, chain.id), eq(assets.isActive, true)));
    const vaultByAddr = new Map(vs.map((v) => [v.address.toLowerCase(), v.id]));
    const assetByAddr = new Map(
        toks.map((a) => [a.tokenAddress.toLowerCase(), a.id]),
    );
    const tsCache = new Map<bigint, Date | null>();

    const out: { id: string; created: boolean }[] = [];
    for (const t of transfers) {
        const vaultId = vaultByAddr.get(t.to.toLowerCase());
        const assetId = assetByAddr.get(t.token.toLowerCase());
        if (!vaultId || !assetId || t.amount <= 0n) continue;

        if (!tsCache.has(t.blockNumber))
            tsCache.set(
                t.blockNumber,
                await getBlockTimestamp(chain.chainId, t.blockNumber),
            );
        const txHash = t.txHash.toLowerCase();
        const inserted = await database
            .insert(depositTransfers)
            .values({
                chainId: chain.id,
                txHash,
                logIndex: t.logIndex,
                vaultId,
                assetId,
                fromAddress: t.from.toLowerCase(),
                amount: t.amount.toString(),
                blockNumber: t.blockNumber.toString(),
                blockHash: t.blockHash,
                blockTimestamp: tsCache.get(t.blockNumber) ?? null,
                verifiedAt: new Date(),
            })
            .onConflictDoNothing()
            .returning({ id: depositTransfers.id });

        if (inserted.length) {
            out.push({ id: inserted[0].id, created: true });
        } else {
            const [ex] = await database
                .select({ id: depositTransfers.id })
                .from(depositTransfers)
                .where(
                    and(
                        eq(depositTransfers.chainId, chain.id),
                        eq(depositTransfers.txHash, txHash),
                        eq(depositTransfers.logIndex, t.logIndex),
                    ),
                )
                .limit(1);
            if (ex) out.push({ id: ex.id, created: false });
        }
    }
    return out;
}

async function autoMatchAll(
    database: Database,
    ids: { id: string; created: boolean }[],
) {
    for (const r of ids)
        if (r.created)
            try {
                await autoMatchTransfer(database, r.id);
            } catch {
                /* stays for manual matching */
            }
}

/* ------------------------------ scanning ----------------------------- */

const inflight = new Map<
    string,
    Promise<{ scanned: boolean; funded: number; found: number }>
>();
const lastRun = new Map<string, number>();

async function doScan(database: Database, chain: ChainRow) {
    const head = await getHead(chain.chainId);
    const [st] = await database
        .select()
        .from(chainScanState)
        .where(eq(chainScanState.chainId, chain.id))
        .limit(1);
    let from = st
        ? BigInt(st.lastScannedBlock) - BigInt(config.REORG_OVERLAP_BLOCKS) + 1n
        : head - BigInt(config.SCAN_LOOKBACK_BLOCKS);
    if (from < 0n) from = 0n;

    const all = await database
        .select({ address: vaults.address })
        .from(vaults)
        .where(and(eq(vaults.chainId, chain.id), eq(vaults.isActive, true)));
    const toks = await database
        .select({ tokenAddress: assets.tokenAddress })
        .from(assets)
        .where(and(eq(assets.chainId, chain.id), eq(assets.isActive, true)));

    // Logs are only fetched for vaults holding a balance at `head`. Deposits
    // are only swept after they are recorded, so an empty vault has nothing new.
    // Vaults with an open deposit are always scanned, even when a sweep has
    // emptied them: a deposit swept before the scan would otherwise be missed.
    const openVaults = await database
        .selectDistinct({ address: vaults.address })
        .from(depositIntents)
        .innerJoin(vaults, eq(vaults.id, depositIntents.vaultId))
        .where(
            and(
                eq(depositIntents.chainId, chain.id),
                inArray(depositIntents.status, ["intent", "transfer_detected"]),
            ),
        );
    const funded = await fundedVaults(
        chain.chainId,
        all.map((v) => v.address),
        toks.map((t) => t.tokenAddress),
        head,
    );
    const vs = [
        ...new Set([
            ...funded,
            ...openVaults.map((v) => v.address.toLowerCase()),
        ]),
    ];

    let found = 0;
    if (vs.length && toks.length) {
        const chunk = BigInt(config.LOG_CHUNK_BLOCKS);
        for (let s = from; s <= head; s += chunk) {
            const e = s + chunk - 1n < head ? s + chunk - 1n : head;
            const logs = await getTransfersInRange(
                chain.chainId,
                toks.map((t) => t.tokenAddress),
                vs,
                s,
                e,
            );
            const rows = await ingest(database, chain, logs);
            found += rows.filter((r) => r.created).length;
            await autoMatchAll(database, rows);
        }
    }

    await database
        .insert(chainScanState)
        .values({
            chainId: chain.id,
            lastScannedBlock: head.toString(),
            updatedAt: new Date(),
        })
        .onConflictDoUpdate({
            target: chainScanState.chainId,
            set: { lastScannedBlock: head.toString(), updatedAt: new Date() },
        });
    return { scanned: true, funded: vs.length, found };
}

// Multicall3 is deployed at this address on every chain we use.
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

async function fundedVaults(
    chainId: number,
    vaultAddrs: string[],
    tokens: string[],
    blockNumber: bigint,
) {
    if (!vaultAddrs.length || !tokens.length) return [];
    const pairs = vaultAddrs.flatMap((v) => tokens.map((t) => [v, t]));
    const balances = await getClient(chainId).multicall({
        multicallAddress: MULTICALL3,
        allowFailure: false,
        blockNumber,
        contracts: pairs.map(([v, t]) => ({
            address: t as Address,
            abi: erc20Abi,
            functionName: "balanceOf" as const,
            args: [v as Address] as const,
        })),
    });
    return [
        ...new Set(pairs.filter((_, i) => balances[i] > 0n).map(([v]) => v)),
    ];
}

// One scan at a time per chain; callers can ask for a minimum gap between scans.
export async function scanChain(
    database: Database,
    chain: ChainRow,
    minIntervalMs = 0,
) {
    const running = inflight.get(chain.id);
    if (running) return running;
    if (
        minIntervalMs &&
        Date.now() - (lastRun.get(chain.id) ?? 0) < minIntervalMs
    )
        return { scanned: false, funded: 0, found: 0 };
    const p = doScan(database, chain).finally(() => {
        inflight.delete(chain.id);
        lastRun.set(chain.id, Date.now());
    });
    inflight.set(chain.id, p);
    return p;
}

/* ------------------------- user: "I sent it" ------------------------- */

async function loadIntentChain(database: Database, intentId: string) {
    const [row] = await database
        .select({
            intent: depositIntents,
            vaultAddress: vaults.address,
            chainUuid: chains.id,
            chainId: chains.chainId,
        })
        .from(depositIntents)
        .innerJoin(vaults, eq(vaults.id, depositIntents.vaultId))
        .innerJoin(chains, eq(chains.id, depositIntents.chainId))
        .where(eq(depositIntents.id, intentId))
        .limit(1);
    if (!row) throw new AppError("Intent not found", 404, "not_found");
    return row;
}

// Throttled rescan of the intent's chain.
export async function checkIntent(
    database: Database,
    intentId: string,
    userId: string,
) {
    const r = await loadIntentChain(database, intentId);
    if (r.intent.userId !== userId)
        throw new AppError("Intent not found", 404, "not_found");
    if (!hasRpc(r.chainId))
        throw new AppError(
            "This chain is not available right now",
            503,
            "no_rpc",
        );
    return scanChain(database, { id: r.chainUuid, chainId: r.chainId }, 10_000);
}

// Fallback when auto-detection missed it: the user gives the tx hash.
// Only transfers of the intent's token into the intent's vault are used.
export async function attachTxToIntent(
    database: Database,
    i: { intentId: string; userId: string; txHash: string },
) {
    const r = await loadIntentChain(database, i.intentId);
    if (r.intent.userId !== i.userId)
        throw new AppError("Intent not found", 404, "not_found");
    if (!["intent", "transfer_detected"].includes(r.intent.status))
        throw new AppError(
            "This deposit can no longer take transfers",
            409,
            "bad_state",
        );
    if (!hasRpc(r.chainId))
        throw new AppError(
            "This chain is not available right now",
            503,
            "no_rpc",
        );

    const tx = await getTransfersInTx(r.chainId, i.txHash);
    if (!tx.found)
        throw new AppError(
            "Transaction not found yet; try again shortly",
            404,
            "tx_not_found",
        );
    if (!tx.success)
        throw new AppError("That transaction failed onchain", 400, "tx_failed");

    const relevant = tx.transfers.filter(
        (t) =>
            t.token.toLowerCase() === r.intent.tokenAddress.toLowerCase() &&
            t.to.toLowerCase() === r.vaultAddress.toLowerCase(),
    );
    if (!relevant.length)
        throw new AppError(
            "No transfer of the selected token to your vault in that transaction",
            404,
            "no_transfer",
        );

    const rows = await ingest(
        database,
        { id: r.chainUuid, chainId: r.chainId },
        relevant,
    );
    let attached = 0;
    for (const row of rows) {
        const [t] = await database
            .select()
            .from(depositTransfers)
            .where(eq(depositTransfers.id, row.id))
            .limit(1);
        if (t && !t.intentId && t.status === "detected") {
            await matchTransfer(database, t.id, i.intentId);
            attached++;
        }
    }
    return { transfers: rows.length, attached };
}

/* --------------------------- admin helpers --------------------------- */

// Admin: record the verified transfer(s) of a tx (optionally one log index).
export async function ingestTransactionByHash(
    database: Database,
    chainUuid: string,
    txHash: string,
    logIndex?: number,
) {
    const [chain] = await database
        .select()
        .from(chains)
        .where(eq(chains.id, chainUuid))
        .limit(1);
    if (!chain) throw new AppError("Chain not found", 404, "not_found");
    if (!hasRpc(chain.chainId))
        throw new AppError("No RPC configured for this chain", 503, "no_rpc");

    const tx = await getTransfersInTx(chain.chainId, txHash);
    if (!tx.found)
        throw new AppError(
            "Transaction not found onchain",
            404,
            "tx_not_found",
        );
    if (!tx.success)
        throw new AppError("Transaction failed onchain", 400, "tx_failed");
    const picked =
        logIndex === undefined
            ? tx.transfers
            : tx.transfers.filter((t) => t.logIndex === logIndex);
    const rows = await ingest(
        database,
        { id: chain.id, chainId: chain.chainId },
        picked,
    );
    await autoMatchAll(database, rows);
    return rows;
}

// A transfer must still be on the canonical chain before it can be swept or
// activated. A missing or reorganized transfer is rejected and cannot become active.
export async function reverifyIntentTransfers(
    database: Database,
    intentId: string,
) {
    const r = await loadIntentChain(database, intentId);
    if (!hasRpc(r.chainId)) {
        if (config.APP_ENV === "prod")
            throw new AppError(
                "No RPC configured for this chain",
                503,
                "no_rpc",
            );
        return;
    }
    const transfers = await database
        .select()
        .from(depositTransfers)
        .where(eq(depositTransfers.intentId, intentId));
    let bad = 0;
    for (const t of transfers) {
        if (t.status === "rejected" || !t.blockHash) continue;
        const receipt = await getReceiptOrNull(r.chainId, t.txHash);
        const ok =
            !!receipt &&
            receipt.status === "success" &&
            receipt.blockHash === t.blockHash &&
            receipt.logs.some((l) => l.logIndex === t.logIndex);
        if (!ok) {
            await database
                .update(depositTransfers)
                .set({ status: "rejected" })
                .where(eq(depositTransfers.id, t.id));
            bad++;
        }
    }
    if (bad) {
        const left = await database
            .select({ id: depositTransfers.id })
            .from(depositTransfers)
            .where(
                and(
                    eq(depositTransfers.intentId, intentId),
                    eq(depositTransfers.status, "pending_review"),
                ),
            );
        if (!left.length)
            await database
                .update(depositIntents)
                .set({ status: "intent", updatedAt: new Date() })
                .where(
                    and(
                        eq(depositIntents.id, intentId),
                        eq(depositIntents.status, "transfer_detected"),
                    ),
                );
        throw new AppError(
            "A transfer is no longer on the canonical chain",
            409,
            "reorged",
        );
    }
}

// The operator's sweep tx must have succeeded and moved the intent's token out
// of the intent's vault. Returns the swept amount (token units), or null when
// the check was skipped (test environment without RPC).
export async function verifySweepTx(
    database: Database,
    intentId: string,
    txHash: string,
): Promise<bigint | null> {
    const r = await loadIntentChain(database, intentId);
    if (!hasRpc(r.chainId)) {
        if (config.APP_ENV === "prod")
            throw new AppError(
                "No RPC configured for this chain",
                503,
                "no_rpc",
            );
        return null;
    }
    const tx = await getTransfersInTx(r.chainId, txHash);
    if (!tx.found)
        throw new AppError(
            "Sweep transaction not found onchain",
            404,
            "tx_not_found",
        );
    if (!tx.success)
        throw new AppError(
            "Sweep transaction failed onchain",
            400,
            "tx_failed",
        );
    const swept = tx.transfers
        .filter(
            (t) =>
                t.token.toLowerCase() === r.intent.tokenAddress.toLowerCase() &&
                t.from.toLowerCase() === r.vaultAddress.toLowerCase(),
        )
        .reduce((s, t) => s + t.amount, 0n);
    if (swept === 0n)
        throw new AppError(
            "That transaction does not move this deposit's token out of its vault",
            400,
            "not_a_sweep",
        );
    // Funds must go to a treasury address (same list the sweep calldata uses).
    if (config.TREASURY_LIST.length || config.APP_ENV === "prod") {
        const outside = tx.transfers.some(
            (t) =>
                t.token.toLowerCase() === r.intent.tokenAddress.toLowerCase() &&
                t.from.toLowerCase() === r.vaultAddress.toLowerCase() &&
                !config.TREASURY_LIST.includes(t.to.toLowerCase()),
        );
        if (outside)
            throw new AppError(
                "The sweep sent funds to an address that is not a treasury address",
                400,
                "not_treasury",
            );
    }
    return swept;
}
