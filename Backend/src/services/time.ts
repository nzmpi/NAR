export const toSeconds = (d: Date): bigint =>
    BigInt(Math.floor(d.getTime() / 1000));
export const fromSeconds = (s: bigint): Date => new Date(Number(s) * 1000);

// Calendar-month addition in UTC, clamping to the month's last day.
export function addMonths(date: Date, months: number): Date {
    const d = new Date(date.getTime());
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
    ).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d;
}
