// Deposit split between tiers. The user types either dollars or percent per
// tier; the API takes basis points that must total 10000.

export type AllocMode = "usd" | "pct";

const num = (s: string) => {
    const t = s.trim().replace(",", ".");
    return /^\d*\.?\d*$/.test(t) && t !== "" && t !== "." ? Number(t) : 0;
};

// Text typed for one tier -> basis points. Dollars need the deposit amount.
export function toBps(raw: string, mode: AllocMode, amount: number): number {
    const v = num(raw);
    if (mode === "pct") return Math.round(v * 100);
    return amount > 0 ? Math.round((v / amount) * 10000) : 0;
}

// Basis points -> the text shown in the box for the given mode.
export function fromBps(bps: number, mode: AllocMode, amount: number): string {
    if (!bps) return "";
    const v = mode === "pct" ? bps / 100 : (amount * bps) / 10000;
    return String(Math.round(v * 100) / 100);
}

// All tiers at once. When the dollars add up to the amount, fix rounding so the
// total is exactly 10000 (e.g. three equal thirds of $1,000).
export function splitBps(
    raws: string[],
    mode: AllocMode,
    amount: number,
): number[] {
    const bps = raws.map((r) => toBps(r, mode, amount));
    const dollars = raws.reduce((s, r) => s + num(r), 0);
    const total = bps.reduce((s, b) => s + b, 0);
    if (
        mode === "usd" &&
        amount > 0 &&
        Math.abs(dollars - amount) < 0.005 &&
        total !== 10000
    ) {
        const i = bps.indexOf(Math.max(...bps));
        bps[i] += 10000 - total;
    }
    return bps;
}
