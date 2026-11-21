import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { bpsPct, fmtUsd, pct } from "../lib/money";
import { POOL_LABEL, type Performance, type Portfolio } from "../lib/types";
import { Card, ErrorText, Hint } from "../components/ui";
import { Sparkline } from "../components/Sparkline";

const RANGES = ["1w", "1m", "3m", "1y", "all"] as const;
const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });

export function Home() {
    const [range, setRange] = useState<(typeof RANGES)[number]>("1m");
    const pf = useQuery({
        queryKey: ["portfolio"],
        queryFn: () => api<Portfolio>("/me/portfolio"),
        refetchInterval: 60_000,
    });
    const perf = useQuery({
        queryKey: ["performance", range],
        queryFn: () => api<Performance>(`/me/performance?range=${range}`),
    });

    if (pf.isLoading) return <Hint>Loading…</Hint>;
    if (pf.error) return <ErrorText error={pf.error} />;
    const p = pf.data!;
    const empty = p.lots.length === 0;

    return (
        <div className="space-y-4">
            <Card>
                <Hint>Total balance</Hint>
                <div className="text-4xl font-semibold tnum mt-1">
                    ${fmtUsd(p.totalBalanceUsd)}
                </div>
                <div
                    className="mt-2 text-sm tnum"
                    style={{
                        color:
                            BigInt(p.accruedYieldUsd) >= 0n
                                ? "var(--good)"
                                : "var(--bad)",
                    }}
                >
                    {BigInt(p.accruedYieldUsd) >= 0n ? "+" : ""}$
                    {fmtUsd(p.accruedYieldUsd)} earned
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                    <div>
                        <Hint>Liquid</Hint>
                        <div className="tnum">
                            ${fmtUsd(p.liquidPrincipalUsd)}
                        </div>
                    </div>
                    <div>
                        <Hint>Locked</Hint>
                        <div className="tnum">
                            ${fmtUsd(p.lockedPrincipalUsd)}
                        </div>
                    </div>
                    {BigInt(p.managerAvailableUsd) > 0n && (
                        <div className="col-span-2">
                            <Hint>Manager funds (not in total)</Hint>
                            <div className="tnum">
                                ${fmtUsd(p.managerAvailableUsd)}
                            </div>
                        </div>
                    )}
                    <div>
                        <Hint>Projected APY</Hint>
                        <div className="tnum">
                            {p.projectedApyBps === null
                                ? "–"
                                : bpsPct(p.projectedApyBps)}
                        </div>
                    </div>
                    <div>
                        <Hint>Actual APY</Hint>
                        <div className="tnum">{pct(p.historicalApy)}</div>
                    </div>
                </div>
                <p className="text-xs text-[var(--hint)] mt-3">
                    Projected APY is the tier target. Returns are not guaranteed
                    and can be negative.
                </p>
            </Card>

            {p.pendingDeposits.length > 0 && (
                <Card>
                    <div className="font-medium">
                        Deposits in progress: {p.pendingDeposits.length}
                    </div>
                    <Hint>
                        Open the Deposit tab to follow or complete them.
                    </Hint>
                </Card>
            )}

            <Card>
                <div className="flex gap-2 mb-3">
                    {RANGES.map((r) => (
                        <button
                            key={r}
                            onClick={() => setRange(r)}
                            className={`px-3 py-1 rounded-full text-sm ${r === range ? "bg-[var(--btn)] text-[var(--btn-fg)]" : "text-[var(--hint)]"}`}
                        >
                            {r.toUpperCase()}
                        </button>
                    ))}
                </div>
                <Sparkline
                    values={perf.data?.points.map((x) => x.index) ?? []}
                />
                <div className="flex justify-between text-sm mt-2">
                    <span className="text-[var(--hint)]">Return</span>
                    <span className="tnum">
                        {pct(perf.data?.cumulativeReturn)}
                    </span>
                </div>
            </Card>

            <div>
                <h2 className="font-medium mb-2">Positions</h2>
                {empty && (
                    <Hint>No positions yet. Make your first deposit.</Hint>
                )}
                <div className="space-y-2">
                    {p.lots.map((l) => (
                        <Card key={l.lotId}>
                            <div className="flex justify-between">
                                <span className="font-medium">
                                    {POOL_LABEL[l.pool]} ·{" "}
                                    {bpsPct(l.projectedApyBps)}
                                </span>
                                <span className="tnum">
                                    ${fmtUsd(l.valueUsd)}
                                </span>
                            </div>
                            <div className="text-sm text-[var(--hint)] mt-1">
                                Opened {fmtDate(l.openedAt)}
                                {l.maturesAt &&
                                    ` · ${new Date(l.maturesAt) > new Date() ? "unlocks" : "unlocked"} ${fmtDate(l.maturesAt)}`}
                            </div>
                            {BigInt(l.reservedUsd) > 0n && (
                                <div className="text-sm text-[var(--warn)] mt-1">
                                    ${fmtUsd(l.reservedUsd)} reserved by a
                                    pending request
                                </div>
                            )}
                        </Card>
                    ))}
                </div>
            </div>
        </div>
    );
}
