import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { config } from "../config.js";
import { AppError } from "../errors.js";

const clients = new Map<number, PublicClient>();

export const hasRpc = (chainId: number) =>
    (config.RPC_URLS[chainId]?.length ?? 0) > 0;

// RPC_URL_<chainId> may hold several comma-separated URLs (used as fallbacks).
export function getClient(chainId: number): PublicClient {
    let c = clients.get(chainId);
    if (!c) {
        const urls = config.RPC_URLS[chainId];
        if (!urls?.length)
            throw new AppError(
                `No RPC configured for chain ${chainId}`,
                503,
                "no_rpc",
            );
        const transports = urls.map((u) =>
            http(u, { timeout: 15_000, retryCount: 2 }),
        );
        c = createPublicClient({
            transport:
                transports.length === 1 ? transports[0] : fallback(transports),
        }) as PublicClient;
        clients.set(chainId, c);
    }
    return c;
}
