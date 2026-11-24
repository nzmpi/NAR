export type PoolKey = "liquid" | "lock_1m" | "lock_2m" | "lock_3m" | "manager";
export const POOL_NAME: Record<string, string> = {
    liquid: "Liquid",
    lock_1m: "Lock 1M",
    lock_2m: "Lock 2M",
    lock_3m: "Lock 3M",
    manager: "Manager",
};

export interface AdminPools {
    totalAssetsUsd: string;
    pools: {
        pool: PoolKey;
        assetsUsd: string;
        shares: string;
        apyBps: number | null;
    }[];
}
export interface AdminPerformance {
    range: string;
    pools: {
        pool: PoolKey;
        cumulativeReturn: number | null;
        apy: number | null;
    }[];
    managerExcessUsd: string;
    participantYieldUsd: string;
    lossUsd: string;
    bonusesPaidUsd: string;
}
export interface SettlementResult {
    settlementId: string;
    pnlUsd: string;
    convertedLots: unknown[];
}

export interface AdminWithdrawal {
    withdrawal: {
        id: string;
        userId: string;
        destinationAddress: string;
        grossAmountUsd: string;
        earlyFeeUsd: string;
        netPayoutUsd: string;
        payoutAmount: string;
        status: string;
        rejectionReason: string | null;
        txHash: string | null;
        lockedAt: string | null;
        createdAt: string;
    };
    telegramId: string;
    username: string | null;
    symbol: string;
    chainId: number;
    decimals?: number;
}

export interface AdminSettlement {
    id: string;
    kind: string;
    previousTotalAssetsUsd: string;
    reportedTotalAssetsUsd: string;
    pnlUsd: string;
    intervalStart: string;
    settledAt: string;
    note: string | null;
    adminTelegramId: string | null;
    allocations: {
        pool: string;
        kind: string;
        amountUsd: string;
        navAfterUsd: string;
    }[];
}

export interface AuditEntry {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    details: unknown;
    createdAt: string;
    adminTelegramId: string;
}

export interface AdminChain {
    id: string;
    name: string;
    chainId: number;
    isActive: boolean;
}

export interface AdminDeposit {
    intent: {
        id: string;
        userId: string;
        vaultId: string;
        assetId: string;
        status: string;
        intendedAmount: string;
        confirmedAmount: string | null;
        confirmedAmountUsd: string | null;
        sweepTxHash: string | null;
        rejectionReason: string | null;
        expiresAt: string;
        createdAt: string;
    };
    telegramId: string;
    username: string | null;
    vaultAddress: string;
    vaultDeployed: boolean;
    symbol: string;
    decimals: number;
    chainId?: number; // missing from older API builds
}

export interface AdminTransfer {
    id: string;
    chainId: string;
    txHash: string;
    logIndex: number;
    vaultId: string;
    assetId: string;
    fromAddress: string | null;
    amount: string;
    status: string;
    intentId: string | null;
    createdAt: string;
}

export interface SweepBatch {
    chainId: number;
    vault: string;
    destination: string;
    tokens: string[];
    amounts: string[];
    transactions: {
        to: string;
        value: string;
        data: string;
        description: string;
    }[];
    safeBatch: unknown;
}

export interface AdminAsset {
    id: string;
    symbol: string;
    name: string;
    tokenAddress: string;
    decimals: number;
    isActive: boolean;
    chainUuid: string;
    chainName: string;
    chainId: number;
}

export interface AllowlistEntry {
    telegramId: string;
    note: string | null;
    createdAt: string;
}

export interface AdminUser {
    id: string;
    telegramId: string;
    username: string | null;
    isBlocked: boolean;
    maxVaults: number;
    createdAt: string;
    // Missing from older API builds; the UI shows "-" then.
    balanceUsd?: string; // micro-USD, current value of open positions
    vaultCount?: number; // active vaults
    isAdmin?: boolean; // has an active admin account
}

export interface AdminVault {
    id: string;
    userId: string;
    telegramId: string;
    username: string | null;
    nonce: number;
    address: string;
    isDeployed: boolean;
    deployTxHash: string | null;
    chainUuid: string;
    chainName: string;
    chainId: number;
}

export interface VaultBalances {
    vaultId: string;
    address: string;
    chainId: number;
    isDeployed: boolean;
    balances: {
        assetId: string;
        symbol: string;
        tokenAddress: string;
        decimals: number;
        balance: string;
    }[];
    native: string;
}

export interface AdminUserPortfolio {
    totalBalanceUsd: string;
    accruedYieldUsd: string;
    projectedApyBps: number | null;
    lots: {
        lotId: string;
        pool: string;
        valueUsd: string;
        maturesAt: string | null;
    }[];
}

export interface AdminRelock {
    request: {
        id: string;
        userId: string;
        status: string;
        settlementId: string | null;
        appliedAt: string | null;
        createdAt: string;
    };
    telegramId: string;
    username: string | null;
    items: {
        id: string;
        sourcePool?: PoolKey;
        targetPool?: PoolKey;
        amountUsd: string | null;
        isMax: boolean;
        reservedUsd: string | null;
        status: string;
        failureReason: string | null;
        appliedUsd: string | null;
    }[];
}

// GET /admin/access-requests: one row per Telegram ID.
export interface AccessRequest {
    telegramId: string;
    username: string | null;
    firstName: string | null;
    status: "pending" | "approved" | "rejected";
    requestedAt: string;
    decidedAt: string | null;
    decidedBy: string | null;
}
