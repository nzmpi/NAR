// Sample data for people without access: the whole app works on these
// numbers, but nothing is sent to the server (see `api`). No deposit is left
// waiting for a transfer, so the demo never shows a deposit address.
import type { PoolKey } from "./types";

const M = (usd: number) => String(Math.round(usd * 1e6));
const at = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString();
const APY: Record<PoolKey, number> = {
    liquid: 600,
    lock_1m: 800,
    lock_2m: 900,
    lock_3m: 1000,
};
const lot = (
    lotId: string,
    pool: PoolKey,
    v: number,
    reserved: number,
    opened: number,
    matures: number | null,
) => ({
    lotId,
    pool,
    valueUsd: M(v),
    principalUsd: M(v * 0.97),
    reservedUsd: M(reserved),
    projectedApyBps: APY[pool],
    openedAt: at(opened),
    maturesAt: matures === null ? null : at(matures),
    source: "deposit",
});
const LOTS = [
    lot("demo-l1", "liquid", 4162.2, 0, -80, null),
    lot("demo-l2", "lock_1m", 3103.36, 500, -20, 10),
    lot("demo-l3", "lock_3m", 5214.8, 0, -30, 60),
];
const ZERO = "0x0000000000000000000000000000000000000000";
const PAYOUT = "0x1111111111111111111111111111111111111111";
const RETURN: Record<string, number> = {
    "1w": 0.0014,
    "1m": 0.0071,
    "3m": 0.0205,
    "1y": 0.0394,
    all: 0.0394,
};

const GET: Record<string, (q: URLSearchParams) => unknown> = {
    "/me": () => ({ id: "demo", isAdmin: false }),
    "/me/portfolio": () => ({
        totalBalanceUsd: M(12480.36),
        liquidPrincipalUsd: M(4000),
        lockedPrincipalUsd: M(8000),
        accruedYieldUsd: M(480.36),
        projectedApyBps: 870,
        historicalApy: 0.081,
        managerAvailableUsd: "0",
        lots: LOTS,
        pendingDeposits: [],
    }),
    "/me/performance": (q) => {
        const range = q.get("range") ?? "1m";
        const ret = RETURN[range] ?? 0.0071;
        return {
            range,
            cumulativeReturn: ret,
            apy: 0.08,
            points: Array.from({ length: 12 }, (_, i) => ({
                t: at(i - 12),
                balanceUsd: "0",
                index: 1 + (ret * i) / 11 + (i % 3) * 0.0004,
            })),
        };
    },
    "/assets": () => [
        {
            assetId: "demo-a1",
            symbol: "USDC",
            name: "USDC",
            tokenAddress: ZERO,
            decimals: 6,
            chainUuid: "demo-c1",
            chainName: "Base",
            chainId: 8453,
        },
        {
            assetId: "demo-a2",
            symbol: "USDC",
            name: "USDC",
            tokenAddress: ZERO,
            decimals: 6,
            chainUuid: "demo-c2",
            chainName: "Arbitrum",
            chainId: 42161,
        },
    ],
    "/me/vaults": () =>
        ["demo-c1", "demo-c2"].map((c, n) => ({
            id: "demo-v" + n,
            nonce: 0,
            address: ZERO,
            isDeployed: true,
            chainUuid: c,
            chainName: n ? "Arbitrum" : "Base",
            chainId: n ? 42161 : 8453,
        })),
    "/me/deposits": () => [
        {
            id: "demo-d1",
            status: "swept_and_confirmed",
            vaultId: "demo-v0",
            assetId: "demo-a1",
            intendedAmount: "2000000000",
            confirmedAmount: "2000000000",
            confirmedAmountUsd: M(2000),
            expiresAt: at(-2),
            createdAt: at(-3),
            allocations: [{ pool: "liquid", bps: 10000 }],
            rejectionReason: null,
        },
        {
            id: "demo-d2",
            status: "swept_and_confirmed",
            vaultId: "demo-v0",
            assetId: "demo-a1",
            intendedAmount: "10000000000",
            confirmedAmount: "10000000000",
            confirmedAmountUsd: M(10000),
            expiresAt: at(-50),
            createdAt: at(-50),
            allocations: [
                { pool: "lock_1m", bps: 4000 },
                { pool: "lock_3m", bps: 6000 },
            ],
            rejectionReason: null,
        },
    ],
    "/me/withdrawals": () => [
        {
            id: "demo-w1",
            assetId: "demo-a1",
            destinationAddress: PAYOUT,
            grossAmountUsd: M(300),
            earlyFeeUsd: "0",
            netPayoutUsd: M(300),
            payoutAmount: "300000000",
            status: "paid",
            rejectionReason: null,
            txHash: null,
            lockedAt: at(-39),
            processedAt: at(-39),
            createdAt: at(-40),
        },
    ],
    "/me/relocks": () => [
        {
            id: "demo-r1",
            status: "applied",
            createdAt: at(-12),
            appliedAt: at(-11),
            items: [
                {
                    id: "demo-i1",
                    targetPool: "lock_3m",
                    status: "applied",
                    failureReason: null,
                    amountUsd: M(1000),
                    isMax: false,
                    appliedUsd: M(1000),
                },
            ],
        },
    ],
    "/me/payout-addresses": () => [{ address: PAYOUT, lastUsedAt: at(-40) }],
};

// Withdrawal review on demo lots. `amountUsd` is the total gross; locked
// picks cover what liquid can't, and pay the 10% early fee.
function previewWithdrawal(b: {
    amountUsd?: string;
    lockSelections?: { lotId: string; grossUsd?: string; max?: boolean }[];
}) {
    const gross = BigInt(b.amountUsd ?? 0);
    const locked = (b.lockSelections ?? []).reduce((s, x) => {
        const l = LOTS.find((y) => y.lotId === x.lotId);
        const avail = l ? BigInt(l.valueUsd) - BigInt(l.reservedUsd) : 0n;
        return s + (x.max ? avail : BigInt(x.grossUsd ?? 0));
    }, 0n);
    const fee = locked / 10n;
    return {
        grossUsd: String(gross),
        feeUsd: String(fee),
        netUsd: String(gross - fee),
        payoutAmount: String(gross - fee),
        lots: [],
    };
}

// The demo answer for a request, or undefined when it would change something.
export function demoAnswer(
    path: string,
    method: string,
    body: unknown,
): unknown {
    const u = new URL(path, "http://demo");
    if (method === "GET")
        return structuredClone(GET[u.pathname]?.(u.searchParams));
    if (u.pathname === "/me/withdrawals/preview")
        return previewWithdrawal(
            body as Parameters<typeof previewWithdrawal>[0],
        );
    return undefined;
}
