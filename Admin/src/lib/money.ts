// Money is integer strings on the wire: USD in micro-USD (1e6), tokens in base units.
export const USD_DECIMALS = 6;

export function formatUnits(
    value: string | bigint,
    decimals: number,
    maxFrac = 2,
): string {
    const v = BigInt(value);
    const neg = v < 0n;
    const abs = neg ? -v : v;
    const base = 10n ** BigInt(decimals);
    const whole = abs / base;
    let frac = (abs % base)
        .toString()
        .padStart(decimals, "0")
        .slice(0, maxFrac);
    frac = frac.padEnd(maxFrac, "0");
    const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    // Whole amounts drop the cents: "60", not "60.00"; "60.50" keeps both.
    return `${neg ? "-" : ""}${w}${/[1-9]/.test(frac) ? "." + frac : ""}`;
}

export const fmtUsd = (micro: string | bigint, maxFrac = 2) =>
    formatUnits(micro, USD_DECIMALS, maxFrac);

// "12.5" -> 12500000n. Returns null for anything that is not a plain decimal.
export function parseUnits(input: string, decimals: number): bigint | null {
    const s = input.trim().replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const [w, f = ""] = s.split(".");
    if (f.length > decimals) return null;
    return (
        BigInt(w) * 10n ** BigInt(decimals) +
        BigInt(f.padEnd(decimals, "0") || "0")
    );
}

export const pct = (x: number | null | undefined, digits = 2) =>
    x === null || x === undefined ? "–" : `${(x * 100).toFixed(digits)}%`;
export const bpsPct = (bps: number) =>
    `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
