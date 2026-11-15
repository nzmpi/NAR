import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { bpsPct, fmtUsd, pct } from "../lib/money";
import type { AdminPerformance, AdminPools } from "../lib/types";
import { Card, ErrorText, Hint } from "../components/ui";

const RANGES = ["1w", "1m", "3m", "1y", "all"] as const;

export function Overview() {
    const [range, setRange] = useState<(typeof RANGES)[number]>("1m");
    const pools = useQuery({
        queryKey: ["admin-pools"],
        queryFn: () => api<AdminPools>("/admin/pools"),
        refetchInterval: 60_000,
    });
    const perf = useQuery({
        queryKey: ["admin-perf", range],
        queryFn: () =>
            api<AdminPerformance>(`/admin/performance?range=${range}`),
    });

    if (pools.isLoading) return <Hint>Loading…</Hint>;
    if (pools.error) return <ErrorText error={pools.error} />;
    const p = pools.data!;
    const perfBy = new Map(perf.data?.pools.map((x) => [x.pool, x]));

    return (
        <div className="space-y-4">
            <Card>
                <Hint>Total managed (as of last settlement)</Hint>
                <div className="text-3xl font-semibold tnum">
                    ${fmtUsd(p.totalAssetsUsd)}
                </div>
            </Card>

            <Card>
                <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-medium">Pools</h2>
                    <div className="flex gap-1">
                        {RANGES.map((r) => (
                            <button
                                key={r}
                                onClick={() => setRange(r)}
                                className={`rounded-full px-2 py-1 text-xs ${r === range ? "bg-[var(--btn)] text-[var(--btn-fg)]" : "text-[var(--hint)]"}`}
                            >
                                {r}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm tnum">
                        <thead className="text-left text-[var(--hint)]">
                            <tr>
                                <th className="py-1">Pool</th>
                                <th>NAV</th>
                                <th>Target APY</th>
                                <th>Return ({range})</th>
                                <th>Realized APY</th>
                            </tr>
                        </thead>
                        <tbody>
                            {p.pools.map((x) => (
                                <tr
                                    key={x.pool}
                                    className="border-t border-[var(--line)]"
                                >
                                    <td className="py-2">{x.pool}</td>
                                    <td>${fmtUsd(x.assetsUsd)}</td>
                                    <td>
                                        {x.apyBps === null
                                            ? "–"
                                            : bpsPct(x.apyBps)}
                                    </td>
                                    <td>
                                        {pct(
                                            perfBy.get(x.pool)
                                                ?.cumulativeReturn,
                                        )}
                                    </td>
                                    <td>{pct(perfBy.get(x.pool)?.apy)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            {perf.data && (
                <Card>
                    <h2 className="mb-2 font-medium">
                        Settled in range ({range})
                    </h2>
                    <dl className="grid grid-cols-2 gap-3 text-sm tnum sm:grid-cols-4">
                        <div>
                            <dt className="text-[var(--hint)]">
                                Participant yield
                            </dt>
                            <dd>${fmtUsd(perf.data.participantYieldUsd)}</dd>
                        </div>
                        <div>
                            <dt className="text-[var(--hint)]">
                                Manager excess
                            </dt>
                            <dd>${fmtUsd(perf.data.managerExcessUsd)}</dd>
                        </div>
                        <div>
                            <dt className="text-[var(--hint)]">Losses</dt>
                            <dd
                                style={{
                                    color:
                                        BigInt(perf.data.lossUsd) < 0n
                                            ? "var(--bad)"
                                            : undefined,
                                }}
                            >
                                ${fmtUsd(perf.data.lossUsd)}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-[var(--hint)]">Bonuses</dt>
                            <dd>${fmtUsd(perf.data.bonusesPaidUsd)}</dd>
                        </div>
                    </dl>
                    <p className="mt-2 text-xs text-[var(--hint)]">
                        Losses are shown as negative values: the pool value
                        lost.
                    </p>
                </Card>
            )}
        </div>
    );
}
