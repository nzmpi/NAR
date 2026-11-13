import {
    TransactionReceiptNotFoundError,
    parseAbiItem,
    parseEventLogs,
    type Address,
    type Hex,
} from "viem";
import { getClient } from "./client.js";

export const TRANSFER_EVENT = parseAbiItem(
    "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export interface ChainTransfer {
    txHash: string;
    logIndex: number;
    token: string; // emitting token contract
    from: string;
    to: string;
    amount: bigint;
    blockNumber: bigint;
    blockHash: string;
}

export const getHead = (chainId: number) => getClient(chainId).getBlockNumber();

export async function getReceiptOrNull(chainId: number, txHash: string) {
    try {
        return await getClient(chainId).getTransactionReceipt({
            hash: txHash as Hex,
        });
    } catch (e) {
        if (e instanceof TransactionReceiptNotFoundError) return null;
        throw e;
    }
}

// ERC-20 Transfer logs into the given vaults from the given tokens.
export async function getTransfersInRange(
    chainId: number,
    tokens: string[],
    vaults: string[],
    fromBlock: bigint,
    toBlock: bigint,
): Promise<ChainTransfer[]> {
    const client = getClient(chainId);
    const out: ChainTransfer[] = [];
    for (let i = 0; i < vaults.length; i += 100) {
        const logs = await client.getLogs({
            address: tokens as Address[],
            event: TRANSFER_EVENT,
            args: { to: vaults.slice(i, i + 100) as Address[] },
            fromBlock,
            toBlock,
        });
        for (const l of logs) {
            if (
                l.removed ||
                l.logIndex === null ||
                l.blockHash === null ||
                l.blockNumber === null
            )
                continue;
            if (!l.args.from || !l.args.to || l.args.value === undefined)
                continue;
            out.push({
                txHash: l.transactionHash as string,
                logIndex: l.logIndex,
                token: l.address,
                from: l.args.from,
                to: l.args.to,
                amount: l.args.value,
                blockNumber: l.blockNumber,
                blockHash: l.blockHash,
            });
        }
    }
    return out;
}

// All ERC-20 Transfer logs in one successful transaction.
export async function getTransfersInTx(chainId: number, txHash: string) {
    const receipt = await getReceiptOrNull(chainId, txHash);
    if (!receipt) return { found: false as const };
    if (receipt.status !== "success")
        return { found: true as const, success: false as const, transfers: [] };
    const logs = parseEventLogs({
        abi: [TRANSFER_EVENT],
        eventName: "Transfer",
        logs: receipt.logs,
    });
    const transfers: ChainTransfer[] = logs.map((l) => ({
        txHash: receipt.transactionHash,
        logIndex: l.logIndex,
        token: l.address,
        from: l.args.from,
        to: l.args.to,
        amount: l.args.value,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
    }));
    return { found: true as const, success: true as const, transfers };
}

export async function getBlockTimestamp(
    chainId: number,
    blockNumber: bigint,
): Promise<Date | null> {
    try {
        const b = await getClient(chainId).getBlock({ blockNumber });
        return new Date(Number(b.timestamp) * 1000);
    } catch {
        return null;
    }
}
