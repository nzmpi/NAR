import { eq } from "drizzle-orm";
import { poolStates, pools } from "../db/schema.js";
import { POOL_KEYS, type PoolKey, type Pools } from "../accounting/pools.js";
import type { Tx } from "./types.js";

export type PoolIds = Record<PoolKey, string>;

// Locks the five pool_states rows in a fixed order (by key) to avoid deadlocks.
export async function loadPoolsForUpdate(
    tx: Tx,
): Promise<{ pools: Pools; ids: PoolIds }> {
    const rows = await tx
        .select({
            key: pools.key,
            poolId: pools.id,
            assets: poolStates.totalAssetsUsd,
            shares: poolStates.totalShares,
        })
        .from(poolStates)
        .innerJoin(pools, eq(pools.id, poolStates.poolId))
        .orderBy(pools.key)
        .for("update", { of: poolStates });

    const out = {} as Pools;
    const ids = {} as PoolIds;
    for (const r of rows) {
        out[r.key as PoolKey] = {
            assets: BigInt(r.assets),
            shares: BigInt(r.shares),
        };
        ids[r.key as PoolKey] = r.poolId;
    }
    for (const k of POOL_KEYS)
        if (!out[k])
            throw new Error(`pool ${k} missing; seed migration not applied`);
    return { pools: out, ids };
}

export async function savePools(tx: Tx, ids: PoolIds, state: Pools) {
    const now = new Date();
    for (const k of POOL_KEYS) {
        await tx
            .update(poolStates)
            .set({
                totalAssetsUsd: state[k].assets.toString(),
                totalShares: state[k].shares.toString(),
                updatedAt: now,
            })
            .where(eq(poolStates.poolId, ids[k]));
    }
}
