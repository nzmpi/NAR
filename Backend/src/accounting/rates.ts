import { P, SECONDS_PER_YEAR } from "./fixed.js";

// ln(1 + bps/10000) at precision P, via 2*atanh((x-1)/(x+1)).
export function ln1pBps(apyBps: number): bigint {
    if (!Number.isInteger(apyBps) || apyBps < 0) throw new Error("bad apy");
    if (apyBps === 0) return 0n;
    const x = (P * BigInt(10_000 + apyBps)) / 10_000n;
    const y = ((x - P) * P) / (x + P);
    const y2 = (y * y) / P;
    let term = y;
    let sum = 0n;
    for (let k = 1n; term > 0n; k += 2n) {
        sum += term / k;
        term = (term * y2) / P;
    }
    return 2n * sum;
}

// exp(z) at precision P for z >= 0 (range reduction by halving).
export function exp(z: bigint): bigint {
    if (z < 0n) throw new Error("exp: negative");
    let k = 0;
    while (z > P / 2n) {
        z /= 2n;
        k++;
    }
    let sum = P;
    let term = P;
    for (let i = 1n; term > 0n; i++) {
        term = (term * z) / (P * i);
        sum += term;
    }
    for (let i = 0; i < k; i++) sum = (sum * sum) / P;
    return sum;
}

// Growth factor (1+apy)^(seconds/year) at precision P. Compounded APY.
export function growthFactor(apyBps: number, seconds: bigint): bigint {
    if (seconds < 0n) throw new Error("negative interval");
    if (seconds === 0n || apyBps === 0) return P;
    return exp((ln1pBps(apyBps) * seconds) / SECONDS_PER_YEAR);
}
