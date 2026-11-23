import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { bpsPct, fmtUsd, pct } from "../lib/money";
import {
    POOL_APY_BPS,
    POOL_LABEL,
    USER_POOLS,
    type Lot,
    type Performance,
} from "../lib/types";
import { usePortfolio, useRelocks, useWithdrawals } from "../lib/queries";
import {
    ErrorText,
    Hint,
    Segmented,
    Skeleton,
    TIER_COLOR,
} from "../components/ui";
import { Sparkline } from "../components/Sparkline";
import type { Tab } from "../App";

const RANGES = [
    { id: "1w", label: "1W", when: "this week" },
    { id: "1m", label: "1M", when: "this month" },
    { id: "3m", label: "3M", when: "in 3 months" },
    { id: "1y", label: "1Y", when: "this year" },
    { id: "all", label: "All", when: "all time" },
] as const;
type Range = (typeof RANGES)[number]["id"];
const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
const PENDING_TEXT: Record<string, string> = {
    intent: "Waiting for your transfer",
    awaiting_user_approval: "Needs your approval",
};

// One card per tier the user holds money in.
function tierCards(lots: Lot[]) {
    const now = Date.now();
    return USER_POOLS.map((pool) => {
        const ls = lots.filter((l) => l.pool === pool);
        const value = ls.reduce((s, l) => s + BigInt(l.valueUsd), 0n);
        const reserved = ls.reduce((s, l) => s + BigInt(l.reservedUsd), 0n);
        const next = ls
            .filter((l) => l.maturesAt && new Date(l.maturesAt).getTime() > now)
            .sort((a, b) => a.maturesAt!.localeCompare(b.maturesAt!))[0];
        // Progress toward the soonest unlock; liquid and matured tiers are full.
        const progress = next
            ? Math.min(
                  100,
                  Math.max(
                      0,
                      ((now - new Date(next.openedAt).getTime()) /
                          (new Date(next.maturesAt!).getTime() -
                              new Date(next.openedAt).getTime())) *
                          100,
                  ),
              )
            : 100;
        const note =
            reserved > 0n
                ? `$${fmtUsd(reserved)} reserved`
                : pool === "liquid"
                  ? "Withdraw any time"
                  : next
                    ? `Unlocks ${fmtDate(next.maturesAt!)}`
                    : "Unlocked";
        return { pool, value, progress, note, warn: reserved > 0n };
    }).filter((t) => t.value > 0n);
}

export function Home({ go }: { go: (t: Tab) => void }) {
    const [range, setRange] = useState<Range>("1m");
    const [tip, setTip] = useState(false);
    const tipRef = useRef<HTMLDivElement>(null);
    // Any tap outside the APY pill or its tip closes the tip.
    useEffect(() => {
        if (!tip) return;
        const close = (e: PointerEvent) => {
            if (!tipRef.current?.contains(e.target as Node)) setTip(false);
        };
        document.addEventListener("pointerdown", close);
        return () => document.removeEventListener("pointerdown", close);
    }, [tip]);
    const pf = usePortfolio();
    const wd = useWithdrawals();
    const rl = useRelocks();
    const perf = useQuery({
        queryKey: ["performance", range],
        queryFn: () => api<Performance>(`/me/performance?range=${range}`),
        placeholderData: keepPreviousData,
    });

    if (pf.isLoading) return <Skeleton />;
    if (pf.error) return <ErrorText error={pf.error} />;
    const p = pf.data!;
    const ret = perf.data?.cumulativeReturn;
    const when = RANGES.find((r) => r.id === range)!.when;
    const manager = BigInt(p.managerAvailableUsd);
    const pending = p.pendingDeposits;
    const wdOpen = (wd.data ?? []).filter((w) => w.status === "pending");
    const rlOpen = (rl.data ?? []).filter((r) => r.status === "pending");
    const cards = tierCards(p.lots);

    return (
        <div className="flex flex-col gap-4">
            <header className="hero -mx-4 -mt-4 flex flex-col gap-3.5 rounded-b-[28px] px-5 pt-6 pb-5 text-white">
                <div className="relative flex items-center justify-between">
                    <span className="text-[13px] opacity-85">
                        Total balance
                    </span>
                    <div ref={tipRef}>
                        <button
                            onClick={() => setTip(!tip)}
                            aria-expanded={tip}
                            aria-label="What is projected APY?"
                            className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-white/20 pr-2.5 pl-3 text-xs font-semibold"
                        >
                            {p.projectedApyBps === null
                                ? "APY"
                                : `${bpsPct(p.projectedApyBps)} APY`}
                            <span
                                aria-hidden="true"
                                className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[11px] font-extrabold text-[#3A3FA8]"
                            >
                                !
                            </span>
                        </button>
                        {tip && (
                            <div
                                role="tooltip"
                                className="absolute top-9 right-0 z-10 w-60 rounded-[14px] bg-[var(--card)] px-3.5 py-3 text-[13px] leading-snug text-[var(--fg)] shadow-xl"
                            >
                                <b>Projected APY</b> is the target rate of your
                                tiers. Returns are not guaranteed and can be
                                negative.
                                {p.historicalApy !== null && (
                                    <> Actual so far: {pct(p.historicalApy)}.</>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                <div className="display text-[46px] leading-none font-bold tracking-tight">
                    ${fmtUsd(p.totalBalanceUsd)}
                </div>
                {ret !== null && ret !== undefined && (
                    <div>
                        <span
                            className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${ret < 0 ? "bg-[#FDE7E4] text-[#B42318]" : "bg-[#E3F4EA] text-[#0F7B4D]"}`}
                        >
                            {ret > 0 ? "+" : ret < 0 ? "−" : ""}
                            {pct(Math.abs(ret))} {when}
                        </span>
                    </div>
                )}
                <Sparkline
                    values={perf.data?.points.map((x) => x.index) ?? []}
                    stroke="#FFFFFF"
                />
                <Segmented
                    label="Range"
                    options={RANGES}
                    value={range}
                    onChange={setRange}
                    onHero
                />
            </header>

            {pending.length > 0 && (
                <InProgress
                    title={count(pending.length, "deposit")}
                    note={PENDING_TEXT[pending[0].status] ?? "Being confirmed"}
                    onClick={() => go("deposit")}
                />
            )}
            {wdOpen.length > 0 && (
                <InProgress
                    title={count(wdOpen.length, "withdrawal")}
                    note={
                        wdOpen.every((w) => w.lockedAt)
                            ? "Being paid"
                            : "Waiting for review"
                    }
                    onClick={() => go("history")}
                />
            )}
            {rlOpen.length > 0 && (
                <InProgress
                    title={count(rlOpen.length, "relock")}
                    note="Applies at the next settlement"
                    onClick={() => go("history")}
                />
            )}

            <h2 className="display text-xl font-bold">Your tiers</h2>
            {cards.length === 0 && (
                <Hint>No positions yet. Make your first deposit.</Hint>
            )}
            <div className="grid grid-cols-2 gap-2.5">
                {cards.map((c) => (
                    <div
                        key={c.pool}
                        className="flex min-w-0 flex-col gap-1.5 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-3.5"
                        style={{ color: TIER_COLOR[c.pool] }}
                    >
                        <span className="self-start rounded-full bg-current/15 px-2.5 py-0.5 text-xs font-semibold">
                            {POOL_LABEL[c.pool]}
                        </span>
                        <span className="display text-xl font-bold text-[var(--fg)]">
                            ${fmtUsd(c.value)}
                        </span>
                        <span className="text-xs text-[var(--hint)]">
                            {bpsPct(POOL_APY_BPS[c.pool])} target APY
                        </span>
                        <span className="h-1.5 rounded-full bg-[var(--track)]">
                            <span
                                className="block h-1.5 rounded-full bg-current"
                                style={{ width: `${c.progress}%` }}
                            />
                        </span>
                        <span
                            className={`text-xs ${c.warn ? "text-[var(--warn)]" : "text-[var(--hint)]"}`}
                        >
                            {c.note}
                        </span>
                    </div>
                ))}
            </div>

            {manager > 0n && (
                <button
                    onClick={() => go("withdraw")}
                    className="flex cursor-pointer flex-col gap-2 rounded-[18px] border-[1.5px] border-dashed border-[var(--mgr)] bg-[var(--mgr-soft)] p-4 text-left"
                >
                    <span className="flex items-center justify-between">
                        <span className="font-bold">Manager funds</span>
                        <span className="rounded-full bg-[var(--mgr)] px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-white">
                            ADMIN
                        </span>
                    </span>
                    <span className="display text-[26px] font-bold">
                        ${fmtUsd(manager)}
                    </span>
                    <span className="text-xs text-[var(--hint)]">
                        Not counted in your total balance. Withdraw it any time,
                        no fee →
                    </span>
                </button>
            )}
        </div>
    );
}

const count = (n: number, what: string) =>
    `${n} ${what}${n === 1 ? "" : "s"} in progress`;

const InProgress = ({
    title,
    note,
    onClick,
}: {
    title: string;
    note: string;
    onClick: () => void;
}) => (
    <button
        onClick={onClick}
        className="flex cursor-pointer items-center gap-2.5 rounded-2xl border border-[var(--line)] bg-[var(--card)] px-4 py-3.5 text-left"
    >
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--warn)]" />
        <span className="flex-1">
            <span className="block font-semibold">{title}</span>
            <span className="block text-xs text-[var(--hint)]">{note}</span>
        </span>
        <span className="text-[var(--hint)]">→</span>
    </button>
);
