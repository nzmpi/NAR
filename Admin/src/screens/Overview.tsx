import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { bpsPct, fmtUsd, pct } from "../lib/money";
import type { AdminPerformance, AdminPools } from "../lib/types";
import type { Tab, useCounts } from "../App";
import {
    ErrorText,
    Hint,
    Panel,
    Segmented,
    TD,
    TH,
    toneOf,
} from "../components/ui";

const RANGES = [
    { id: "1w", label: "1W" },
    { id: "1m", label: "1M" },
    { id: "3m", label: "3M" },
    { id: "1y", label: "1Y" },
    { id: "all", label: "All" },
] as const;
type Range = (typeof RANGES)[number]["id"];
const POOL_NAME: Record<string, string> = {
    liquid: "Liquid",
    lock_1m: "Lock 1M",
    lock_2m: "Lock 2M",
    lock_3m: "Lock 3M",
    manager: "Manager",
};

const Stat = ({
    label,
    value,
    color,
}: {
    label: string;
    value: string;
    color?: string;
}) => (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-[18px]">
        <div className="text-[13px] text-[var(--hint)]">{label}</div>
        <div className="display text-2xl font-semibold" style={{ color }}>
            {value}
        </div>
    </div>
);

export function Overview({
    counts,
    go,
}: {
    counts: ReturnType<typeof useCounts>;
    go: (t: Tab) => void;
}) {
    const [range, setRange] = useState<Range>("1m");
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
    const total = BigInt(p.totalAssetsUsd);
    const rangeLabel =
        range === "all"
            ? "all time"
            : RANGES.find((r) => r.id === range)!.label;
    const loss = perf.data ? BigInt(perf.data.lossUsd) : 0n;
    const todo = [
        counts.withdrawals > 0 && {
            text: `${counts.withdrawals} withdrawal${counts.withdrawals === 1 ? "" : "s"} pending`,
            tab: "withdrawals" as const,
        },
        counts.deposits > 0 && {
            text: `${counts.deposits} deposit${counts.deposits === 1 ? "" : "s"} need action`,
            tab: "deposits" as const,
        },
        counts.transfers > 0 && {
            text: `${counts.transfers} unmatched transfer${counts.transfers === 1 ? "" : "s"}`,
            tab: "transfers" as const,
        },
    ].filter((x) => !!x);

    return (
        <div className="flex flex-col gap-5">
            {todo.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[14px] border border-[var(--warn-line)] bg-[var(--warn-soft)] px-[18px] py-3.5">
                    <span className="font-semibold text-[var(--warn)]">
                        Needs attention
                    </span>
                    {todo.map((t) => (
                        <button
                            key={t.tab}
                            onClick={() => go(t.tab)}
                            className="cursor-pointer underline-offset-2 hover:underline"
                        >
                            {t.text}
                        </button>
                    ))}
                </div>
            )}

            <div className="flex justify-end">
                <Segmented
                    label="Range"
                    options={RANGES}
                    value={range}
                    onChange={setRange}
                />
            </div>

            <section
                aria-label="Key figures"
                className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3"
            >
                <div className="col-span-full flex min-w-0 flex-col gap-1.5 rounded-2xl border border-[var(--hero-line)] bg-[var(--hero)] p-5 sm:col-span-2">
                    <div className="text-[13px] font-medium text-[var(--hero-label)]">
                        Total managed
                    </div>
                    <div className="display text-[40px] leading-tight font-semibold tracking-tight">
                        ${fmtUsd(total)}
                    </div>
                </div>
                {perf.data && (
                    <>
                        <Stat
                            label={`Participant yield · ${rangeLabel}`}
                            value={`$${fmtUsd(perf.data.participantYieldUsd)}`}
                        />
                        <Stat
                            label={`Manager excess · ${rangeLabel}`}
                            value={`$${fmtUsd(perf.data.managerExcessUsd)}`}
                        />
                        <Stat
                            label={`Losses · ${rangeLabel}`}
                            value={`${loss < 0n ? "−" : ""}$${fmtUsd(loss < 0n ? -loss : loss)}`}
                            color={toneOf(loss)}
                        />
                    </>
                )}
            </section>
            <ErrorText error={perf.error} />

            <Panel
                title="Pools"
                right={
                    <span className="text-[13px] text-[var(--hint)]">
                        Return and realized APY over {rangeLabel}
                    </span>
                }
            >
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] border-collapse">
                        <thead>
                            <tr>
                                <th className={TH}>Pool</th>
                                <th className={`${TH} text-right`}>NAV</th>
                                <th className={`${TH} w-[22%]`}>Share</th>
                                <th className={`${TH} text-right`}>
                                    Target APY
                                </th>
                                <th className={`${TH} text-right`}>Return</th>
                                <th className={`${TH} text-right`}>
                                    Realized APY
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {p.pools.map((x) => {
                                const r = perfBy.get(x.pool)?.cumulativeReturn;
                                const share =
                                    total > 0n
                                        ? Number(
                                              (BigInt(x.assetsUsd) * 1000n) /
                                                  total,
                                          ) / 10
                                        : 0;
                                return (
                                    <tr
                                        key={x.pool}
                                        className="border-t border-[var(--row)]"
                                    >
                                        <td className={`${TD} font-semibold`}>
                                            {POOL_NAME[x.pool] ?? x.pool}
                                        </td>
                                        <td className={`${TD} text-right`}>
                                            ${fmtUsd(x.assetsUsd)}
                                        </td>
                                        <td className={TD}>
                                            <div
                                                className="h-1.5 rounded-full bg-[var(--track)]"
                                                title={`${share}%`}
                                            >
                                                <div
                                                    className="h-1.5 rounded-full bg-[var(--btn)]"
                                                    style={{
                                                        width: `${Math.max(0, Math.min(100, share))}%`,
                                                    }}
                                                />
                                            </div>
                                        </td>
                                        <td className={`${TD} text-right`}>
                                            {x.apyBps === null
                                                ? "–"
                                                : bpsPct(x.apyBps)}
                                        </td>
                                        <td
                                            className={`${TD} text-right font-medium`}
                                            style={{
                                                color:
                                                    r == null || r === 0
                                                        ? undefined
                                                        : r > 0
                                                          ? "var(--good)"
                                                          : "var(--bad)",
                                            }}
                                        >
                                            {r != null && r > 0 ? "+" : ""}
                                            {pct(r)}
                                        </td>
                                        <td className={`${TD} text-right`}>
                                            {pct(perfBy.get(x.pool)?.apy)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Panel>
        </div>
    );
}
