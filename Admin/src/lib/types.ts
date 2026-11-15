export type PoolKey = "liquid" | "lock_1m" | "lock_2m" | "lock_3m" | "manager";

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
        createdAt: string;
    };
    telegramId: string;
    username: string | null;
    symbol: string;
    chainId: number;
    decimals?: number;
}
