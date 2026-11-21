import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtUsd } from "../lib/money";
import type { AdminSettlement } from "../lib/types";
import { ErrorText, Hint, signedUsd, TD, TH, toneOf } from "../components/ui";

export function Settlements() {
    const [all, setAllState] = useState(() => {
        try {
            return localStorage.getItem("nar.settlements.all") === "1";
        } catch {
            return false;
        }
    });
    const setAll = (v: boolean) => {
        setAllState(v);
        try {
            localStorage.setItem("nar.settlements.all", v ? "1" : "0");
        } catch {
            /* private mode: just don't remember */
        }
    };
    const [open, setOpen] = useState<string | null>(null);
    const q = useQuery({
        queryKey: ["admin-settlements", all],
        queryFn: () =>
            api<AdminSettlement[]>(
                `/admin/settlements${all ? "?all=true" : ""}`,
            ),
    });

    return (
        <div className="flex flex-col gap-5">
            <label className="inline-flex cursor-pointer items-center gap-2.5 text-[var(--soft)]">
                <input
                    type="checkbox"
                    className="h-[18px] w-[18px]"
                    checked={all}
                    onChange={(e) => setAll(e.target.checked)}
                />
                Include automatic checkpoints (created before each deposit,
                withdrawal or relock)
            </label>
            {q.isLoading && <Hint>Loading…</Hint>}
            <ErrorText error={q.error} />
            {q.data?.length === 0 && <Hint>No settlements yet.</Hint>}
            {!!q.data?.length && (
                <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] tnum">
                    {q.data.map((s, i) => {
                        const pnl = BigInt(s.pnlUsd);
                        const isOpen = open === s.id;
                        return (
                            <div
                                key={s.id}
                                className={
                                    i ? "border-t border-[var(--row)]" : ""
                                }
                            >
                                <button
                                    aria-expanded={isOpen}
                                    onClick={() =>
                                        setOpen(isOpen ? null : s.id)
                                    }
                                    className="flex w-full cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-left"
                                >
                                    <span className="min-w-0 flex-[1_1_220px]">
                                        <span className="block font-semibold">
                                            {new Date(
                                                s.settledAt,
                                            ).toLocaleString()}
                                        </span>
                                        <span className="block text-xs text-[var(--hint)]">
                                            {s.kind}
                                            {s.adminTelegramId &&
                                                ` · admin ${s.adminTelegramId}`}
                                        </span>
                                    </span>
                                    <span className="text-[var(--soft)]">
                                        ${fmtUsd(s.previousTotalAssetsUsd)} → $
                                        {fmtUsd(s.reportedTotalAssetsUsd)}
                                    </span>
                                    <span
                                        className="min-w-[110px] text-right font-semibold"
                                        style={{
                                            color: toneOf(pnl) ?? "var(--hint)",
                                        }}
                                    >
                                        {signedUsd(pnl, fmtUsd)}
                                    </span>
                                    <svg
                                        width="18"
                                        height="18"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        aria-hidden="true"
                                        className={`text-[var(--hint)] ${isOpen ? "rotate-180" : ""}`}
                                    >
                                        <path d="M6 9l6 6 6-6" />
                                    </svg>
                                </button>
                                {isOpen && (
                                    <div className="flex flex-col gap-2.5 px-5 pb-[18px]">
                                        {s.note && <Hint>Note: {s.note}</Hint>}
                                        {s.allocations.length === 0 ? (
                                            <Hint>
                                                No allocations (no change).
                                            </Hint>
                                        ) : (
                                            <div className="overflow-x-auto rounded-xl border border-[var(--line)]">
                                                <table className="w-full min-w-[520px] border-collapse">
                                                    <thead className="bg-[var(--bg)]">
                                                        <tr>
                                                            <th className={TH}>
                                                                Pool
                                                            </th>
                                                            <th className={TH}>
                                                                Type
                                                            </th>
                                                            <th
                                                                className={`${TH} text-right`}
                                                            >
                                                                Amount
                                                            </th>
                                                            <th
                                                                className={`${TH} text-right`}
                                                            >
                                                                NAV after
                                                            </th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {s.allocations.map(
                                                            (a, k) => {
                                                                const amt =
                                                                    BigInt(
                                                                        a.amountUsd,
                                                                    );
                                                                return (
                                                                    <tr
                                                                        key={k}
                                                                        className="border-t border-[var(--row)]"
                                                                    >
                                                                        <td
                                                                            className={
                                                                                TD
                                                                            }
                                                                        >
                                                                            {
                                                                                a.pool
                                                                            }
                                                                        </td>
                                                                        <td
                                                                            className={`${TD} text-[var(--soft)]`}
                                                                        >
                                                                            {
                                                                                a.kind
                                                                            }
                                                                        </td>
                                                                        <td
                                                                            className={`${TD} text-right font-medium`}
                                                                            style={{
                                                                                color: toneOf(
                                                                                    amt,
                                                                                ),
                                                                            }}
                                                                        >
                                                                            {signedUsd(
                                                                                amt,
                                                                                fmtUsd,
                                                                            )}
                                                                        </td>
                                                                        <td
                                                                            className={`${TD} text-right`}
                                                                        >
                                                                            $
                                                                            {fmtUsd(
                                                                                a.navAfterUsd,
                                                                            )}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            },
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </section>
            )}
        </div>
    );
}
