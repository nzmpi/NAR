export type PoolKey = "liquid" | "lock_1m" | "lock_2m" | "lock_3m";
export const USER_POOLS: PoolKey[] = [
    "liquid",
    "lock_1m",
    "lock_2m",
    "lock_3m",
];
export const POOL_LABEL: Record<PoolKey, string> = {
    liquid: "Liquid",
    lock_1m: "1 month",
    lock_2m: "2 months",
    lock_3m: "3 months",
};
// Projected APY (display only), basis points. Matches the backend tiers.
export const POOL_APY_BPS: Record<PoolKey, number> = {
    liquid: 600,
    lock_1m: 800,
    lock_2m: 900,
    lock_3m: 1000,
};

export interface Asset {
    assetId: string;
    symbol: string;
    name: string;
    tokenAddress: string;
    decimals: number;
    chainUuid: string;
    chainName: string;
    chainId: number;
}
export interface Vault {
    id: string;
    nonce: number;
    address: string;
    isDeployed: boolean;
    chainUuid: string;
    chainName: string;
    chainId: number;
}
export interface Lot {
    lotId: string;
    pool: PoolKey;
    valueUsd: string;
    principalUsd: string;
    reservedUsd: string;
    projectedApyBps: number;
    openedAt: string;
    maturesAt: string | null;
    source: string;
}
export interface PendingDeposit {
    id: string;
    status: string;
    intendedAmount: string;
    confirmedAmount: string | null;
    confirmedAmountUsd: string | null;
    assetId: string;
    expiresAt: string;
}
export interface Portfolio {
    totalBalanceUsd: string;
    liquidPrincipalUsd: string;
    lockedPrincipalUsd: string;
    accruedYieldUsd: string;
    projectedApyBps: number | null;
    historicalApy: number | null;
    lots: Lot[];
    pendingDeposits: PendingDeposit[];
}
export interface Performance {
    range: string;
    cumulativeReturn: number | null;
    apy: number | null;
    points: { t: string; balanceUsd: string; index: number }[];
}
export interface Intent {
    id: string;
    status: string;
    vaultId: string;
    assetId: string;
    intendedAmount: string;
    confirmedAmount: string | null;
    confirmedAmountUsd: string | null;
    expiresAt: string;
    createdAt: string;
    allocations: { pool: PoolKey; bps: number }[];
}
