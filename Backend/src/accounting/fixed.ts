// Fixed-point helpers. All values are bigint. Never use floats.
export const USD_MICRO = 1_000_000n; // 1 USD
export const SHARE_SCALE = 10n ** 18n; // 1 share
export const SHARES_PER_MICRO = SHARE_SCALE / USD_MICRO; // 1e12: first mint = 1 USD per share

export function mulDivFloor(a: bigint, b: bigint, d: bigint): bigint {
    if (d <= 0n) throw new Error("mulDiv: divisor must be positive");
    if (a < 0n || b < 0n) throw new Error("mulDiv: negative operand");
    return (a * b) / d;
}

export function mulDivCeil(a: bigint, b: bigint, d: bigint): bigint {
    if (d <= 0n) throw new Error("mulDiv: divisor must be positive");
    if (a < 0n || b < 0n) throw new Error("mulDiv: negative operand");
    return (a * b + d - 1n) / d;
}
