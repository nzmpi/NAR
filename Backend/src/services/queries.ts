import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
    assets,
    chains,
    depositIntentAllocations,
    depositIntents,
    depositTransfers,
    payoutAddresses,
    pools,
    poolStates,
    positionLots,
    relockItems,
    relockRequests,
    users,
    vaults,
    withdrawalAllocations,
    withdrawals,
} from "../db/schema.js";
import {
    APY_BPS,
    POOL_KEYS,
    totalAssets,
    valueOfShares,
    type PoolKey,
    type Pools,
} from "../accounting/pools.js";
import type { Database } from "./types.js";
import { computePerformance } from "./history.js";

const LIMIT = 200;

// Non-locking read of the current settled pool states.
export async function readPools(database: Database) {
    const rows = await database
        .select({
            key: pools.key,
            id: pools.id,
            assets: poolStates.totalAssetsUsd,
            shares: poolStates.totalShares,
        })
        .from(poolStates)
        .innerJoin(pools, eq(pools.id, poolStates.poolId));
    const state = {} as Pools;
    const keyById = new Map<string, PoolKey>();
    for (const r of rows) {
        state[r.key as PoolKey] = {
            assets: BigInt(r.assets),
            shares: BigInt(r.shares),
        };
        keyById.set(r.id, r.key as PoolKey);
    }
    return { state, keyById };
}

export function listAssets(database: Database) {
    return database
        .select({
            assetId: assets.id,
            symbol: assets.symbol,
            name: assets.name,
            tokenAddress: assets.tokenAddress,
            decimals: assets.decimals,
            chainUuid: chains.id,
            chainName: chains.name,
            chainId: chains.chainId,
        })
        .from(assets)
        .innerJoin(chains, eq(chains.id, assets.chainId))
        .where(and(eq(assets.isActive, true), eq(chains.isActive, true)));
}

export function listUserVaults(database: Database, userId: string) {
    return database
        .select({
            id: vaults.id,
            address: vaults.address,
            isDeployed: vaults.isDeployed,
            chainUuid: chains.id,
            chainName: chains.name,
            chainId: chains.chainId,
            nonce: vaults.nonce,
        })
        .from(vaults)
        .innerJoin(chains, eq(chains.id, vaults.chainId))
        .where(and(eq(vaults.userId, userId), eq(vaults.isActive, true)));
}

export async function getPortfolio(database: Database, userId: string) {
    const { state, keyById } = await readPools(database);
    const lots = await database
        .select()
        .from(positionLots)
        .where(
            and(eq(positionLots.userId, userId), isNull(positionLots.closedAt)),
        )
        .orderBy(positionLots.openedAt);

    let total = 0n,
        liquidPrincipal = 0n,
        lockedPrincipal = 0n,
        weighted = 0n;
    const out = [];
    for (const l of lots) {
        const key = keyById.get(l.poolId)!;
        if (key === "manager") continue; // manager pool is admin-only
        const value = valueOfShares(state[key], BigInt(l.shares));
        const reserved = valueOfShares(state[key], BigInt(l.reservedShares));
        const principal = BigInt(l.principalUsd);
        const bps = APY_BPS[key];
        total += value;
        weighted += value * BigInt(bps);
        if (key === "liquid") liquidPrincipal += principal;
        else lockedPrincipal += principal;
        out.push({
            lotId: l.id,
            pool: key,
            valueUsd: value,
            principalUsd: principal,
            reservedUsd: reserved,
            projectedApyBps: bps,
            openedAt: l.openedAt,
            maturesAt: l.maturesAt,
            source: l.sourceType,
        });
    }

    const pending = await database
        .select({
            id: depositIntents.id,
            status: depositIntents.status,
            intendedAmount: depositIntents.intendedAmount,
            confirmedAmount: depositIntents.confirmedAmount,
            confirmedAmountUsd: depositIntents.confirmedAmountUsd,
            assetId: depositIntents.assetId,
            expiresAt: depositIntents.expiresAt,
        })
        .from(depositIntents)
        .where(
            and(
                eq(depositIntents.userId, userId),
                inArray(depositIntents.status, [
                    "intent",
                    "transfer_detected",
                    "awaiting_user_approval",
                    "ready_to_activate",
                ]),
            ),
        );

    const perf = await computePerformance(database, userId, "all");

    return {
        totalBalanceUsd: total,
        liquidPrincipalUsd: liquidPrincipal,
        lockedPrincipalUsd: lockedPrincipal,
        accruedYieldUsd: total - liquidPrincipal - lockedPrincipal,
        projectedApyBps: total > 0n ? Number(weighted / total) : null,
        historicalApy: perf.apy,
        lots: out,
        pendingDeposits: pending,
    };
}

export async function listUserDeposits(database: Database, userId: string) {
    const intents = await database
        .select()
        .from(depositIntents)
        .where(eq(depositIntents.userId, userId))
        .orderBy(desc(depositIntents.createdAt))
        .limit(LIMIT);
    if (!intents.length) return [];
    const ids = intents.map((i) => i.id);
    const allocs = await database
        .select()
        .from(depositIntentAllocations)
        .where(inArray(depositIntentAllocations.intentId, ids));
    const { keyById } = await readPools(database);
    return intents.map((i) => ({
        ...i,
        allocations: allocs
            .filter((a) => a.intentId === i.id)
            .map((a) => ({ pool: keyById.get(a.poolId), bps: a.shareBps })),
    }));
}

export async function listUserWithdrawals(database: Database, userId: string) {
    const ws = await database
        .select()
        .from(withdrawals)
        .where(eq(withdrawals.userId, userId))
        .orderBy(desc(withdrawals.createdAt))
        .limit(LIMIT);
    if (!ws.length) return [];
    const allocs = await database
        .select()
        .from(withdrawalAllocations)
        .where(
            inArray(
                withdrawalAllocations.withdrawalId,
                ws.map((w) => w.id),
            ),
        );
    return ws.map((w) => ({
        ...w,
        allocations: allocs.filter((a) => a.withdrawalId === w.id),
    }));
}

export async function listUserRelocks(database: Database, userId: string) {
    const rs = await database
        .select()
        .from(relockRequests)
        .where(eq(relockRequests.userId, userId))
        .orderBy(desc(relockRequests.createdAt))
        .limit(LIMIT);
    if (!rs.length) return [];
    const items = await database
        .select()
        .from(relockItems)
        .where(
            inArray(
                relockItems.requestId,
                rs.map((r) => r.id),
            ),
        );
    const { keyById } = await readPools(database);
    return rs.map((r) => ({
        ...r,
        items: items
            .filter((i) => i.requestId === r.id)
            .map((i) => ({ ...i, targetPool: keyById.get(i.targetPoolId) })),
    }));
}

export function listPayoutAddresses(database: Database, userId: string) {
    return database
        .select({
            address: payoutAddresses.address,
            lastUsedAt: payoutAddresses.lastUsedAt,
        })
        .from(payoutAddresses)
        .where(eq(payoutAddresses.userId, userId))
        .orderBy(desc(payoutAddresses.lastUsedAt));
}

/* ------------------------------ admin ------------------------------ */

export async function adminPools(database: Database) {
    const { state } = await readPools(database);
    return {
        totalAssetsUsd: totalAssets(state),
        pools: POOL_KEYS.map((k) => ({
            pool: k,
            assetsUsd: state[k].assets,
            shares: state[k].shares,
            apyBps: k === "manager" ? null : APY_BPS[k],
        })),
    };
}

export function adminListDeposits(database: Database, status?: string) {
    return database
        .select({
            intent: depositIntents,
            telegramId: users.telegramId,
            username: users.username,
            vaultAddress: vaults.address,
            vaultDeployed: vaults.isDeployed,
            symbol: assets.symbol,
            decimals: assets.decimals,
        })
        .from(depositIntents)
        .innerJoin(users, eq(users.id, depositIntents.userId))
        .innerJoin(vaults, eq(vaults.id, depositIntents.vaultId))
        .innerJoin(assets, eq(assets.id, depositIntents.assetId))
        .where(status ? eq(depositIntents.status, status) : undefined)
        .orderBy(desc(depositIntents.createdAt))
        .limit(LIMIT);
}

export function adminListTransfers(database: Database, unmatchedOnly: boolean) {
    return database
        .select()
        .from(depositTransfers)
        .where(unmatchedOnly ? isNull(depositTransfers.intentId) : undefined)
        .orderBy(desc(depositTransfers.createdAt))
        .limit(LIMIT);
}

export function adminListWithdrawals(database: Database, status?: string) {
    return database
        .select({
            withdrawal: withdrawals,
            telegramId: users.telegramId,
            username: users.username,
            symbol: assets.symbol,
            chainId: chains.chainId,
        })
        .from(withdrawals)
        .innerJoin(users, eq(users.id, withdrawals.userId))
        .innerJoin(assets, eq(assets.id, withdrawals.assetId))
        .innerJoin(chains, eq(chains.id, assets.chainId))
        .where(status ? eq(withdrawals.status, status) : undefined)
        .orderBy(desc(withdrawals.createdAt))
        .limit(LIMIT);
}

export function adminListUsers(database: Database) {
    return database
        .select()
        .from(users)
        .orderBy(desc(users.createdAt))
        .limit(LIMIT);
}
