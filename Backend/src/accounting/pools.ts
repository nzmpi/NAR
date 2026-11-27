import { SHARES_PER_MICRO, mulDivCeil, mulDivFloor } from "./fixed.js";

export type PoolKey = "liquid" | "lock_1m" | "lock_2m" | "lock_3m" | "manager";
export type LockKey = "lock_1m" | "lock_2m" | "lock_3m";
export interface PoolState {
    assets: bigint; // USD micro
    shares: bigint; // 18 decimals
}
export type Pools = Record<PoolKey, PoolState>;

export const POOL_KEYS: PoolKey[] = [
    "liquid",
    "lock_1m",
    "lock_2m",
    "lock_3m",
    "manager",
];
export const LOCK_KEYS: LockKey[] = ["lock_1m", "lock_2m", "lock_3m"];
// Lock length per pool, used by deposits and relocks alike.
export const LOCK_MONTHS: Record<PoolKey, number> = {
    liquid: 0,
    lock_1m: 1,
    lock_2m: 2,
    lock_3m: 3,
    manager: 0,
};
// Accepted tokens, valued 1 token = 1 USD.
export const STABLES = ["USDT", "USDC", "DAI"];
export const TX_HASH = /^0x[a-fA-F0-9]{64}$/;
export const APY_BPS: Record<Exclude<PoolKey, "manager">, number> = {
    liquid: 600,
    lock_1m: 800,
    lock_2m: 900,
    lock_3m: 1000,
};

export const emptyPools = (): Pools => ({
    liquid: { assets: 0n, shares: 0n },
    lock_1m: { assets: 0n, shares: 0n },
    lock_2m: { assets: 0n, shares: 0n },
    lock_3m: { assets: 0n, shares: 0n },
    manager: { assets: 0n, shares: 0n },
});

export const clonePools = (p: Pools): Pools =>
    Object.fromEntries(POOL_KEYS.map((k) => [k, { ...p[k] }])) as Pools;

export const totalAssets = (p: Pools): bigint =>
    POOL_KEYS.reduce((s, k) => s + p[k].assets, 0n);

function checkPool(s: PoolState) {
    if (s.assets < 0n || s.shares < 0n) throw new Error("negative pool state");
    if (s.shares > 0n && s.assets === 0n)
        throw new Error("pool has shares but zero assets (wiped out)");
    if (s.shares === 0n && s.assets > 0n)
        throw new Error("pool has assets but no shares");
}

// Shares minted for a USD deposit. Floor. First mint: 1 USD = 1 share.
export function sharesForDeposit(s: PoolState, usd: bigint): bigint {
    if (usd <= 0n) throw new Error("amount must be positive");
    checkPool(s);
    const shares =
        s.shares === 0n
            ? usd * SHARES_PER_MICRO
            : mulDivFloor(usd, s.shares, s.assets);
    if (shares <= 0n) throw new Error("would mint zero shares");
    return shares;
}

// Current USD value of shares. Floor.
export function valueOfShares(s: PoolState, shares: bigint): bigint {
    if (s.shares === 0n) return 0n;
    return mulDivFloor(shares, s.assets, s.shares);
}

// Shares to burn to take `usd` out. Ceil, so the pool never underpays itself.
export function sharesForWithdrawal(s: PoolState, usd: bigint): bigint {
    if (usd <= 0n) throw new Error("amount must be positive");
    checkPool(s);
    return mulDivCeil(usd, s.shares, s.assets);
}

export function mint(
    s: PoolState,
    usd: bigint,
): { state: PoolState; shares: bigint } {
    const shares = sharesForDeposit(s, usd);
    return {
        state: { assets: s.assets + usd, shares: s.shares + shares },
        shares,
    };
}

// Burn exact shares; returns USD value (floor) leaving the pool.
export function burn(
    s: PoolState,
    shares: bigint,
): { state: PoolState; usd: bigint } {
    if (shares <= 0n || shares > s.shares) throw new Error("bad share amount");
    // Burning every share drains the pool exactly (no orphaned rounding dust).
    const usd = shares === s.shares ? s.assets : valueOfShares(s, shares);
    return {
        state: { assets: s.assets - usd, shares: s.shares - shares },
        usd,
    };
}
