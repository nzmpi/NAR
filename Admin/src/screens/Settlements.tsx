import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtUsd } from "../lib/money";
import type { AdminSettlement } from "../lib/types";
import { Card, ErrorText, Hint } from "../components/ui";

export function Settlements() {
    const [all, setAll] = useState(false);
    const [open, setOpen] = useState<string | null>(null);
    const q = useQuery({
        queryKey: ["admin-settlements", all],
        queryFn: () =>
            api<AdminSettlement[]>(
                `/admin/settlements${all ? "?all=true" : ""}`,
            ),
    });

    return (
        <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
                <input
                    type="checkbox"
                    checked={all}
                    onChange={(e) => setAll(e.target.checked)}
                />
                Include automatic checkpoints (created before each deposit,
                withdrawal or relock)
            </label>
            {q.isLoading && <Hint>Loading…</Hint>}
            <ErrorText error={q.error} />
            {q.data?.length === 0 && <Hint>No settlements yet.</Hint>}
            {q.data?.map((s) => {
                const pnl = BigInt(s.pnlUsd);
                return (
                    <Card key={s.id} className="space-y-2">
                        <button
                            className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                            onClick={() => setOpen(open === s.id ? null : s.id)}
                        >
                            <span className="text-sm">
                                <b>{new Date(s.settledAt).toLocaleString()}</b>
                                <span className="ml-2 text-[var(--hint)]">
                                    {s.kind}
                                    {s.adminTelegramId &&
                                        ` · admin ${s.adminTelegramId}`}
                                </span>
                            </span>
                            <span className="text-sm tnum">
                                ${fmtUsd(s.previousTotalAssetsUsd)} → $
                                {fmtUsd(s.reportedTotalAssetsUsd)}{" "}
                                <b
                                    style={{
                                        color:
                                            pnl > 0n
                                                ? "var(--good)"
                                                : pnl < 0n
                                                  ? "var(--bad)"
                                                  : undefined,
                                    }}
                                >
                                    ({pnl >= 0n ? "+" : "-"}$
                                    {fmtUsd(pnl >= 0n ? pnl : -pnl)})
                                </b>
                            </span>
                        </button>
                        {s.note && (
                            <div className="text-sm text-[var(--hint)]">
                                Note: {s.note}
                            </div>
                        )}
                        {open === s.id &&
                            (s.allocations.length === 0 ? (
                                <Hint>No allocations (no change).</Hint>
                            ) : (
                                <table className="w-full text-sm tnum">
                                    <thead className="text-left text-[var(--hint)]">
                                        <tr>
                                            <th className="py-1">Pool</th>
                                            <th>Type</th>
                                            <th>Amount</th>
                                            <th>NAV after</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {s.allocations.map((a, k) => (
                                            <tr
                                                key={k}
                                                className="border-t border-[var(--line)]"
                                            >
                                                <td className="py-1">
                                                    {a.pool}
                                                </td>
                                                <td>{a.kind}</td>
                                                <td
                                                    style={{
                                                        color:
                                                            BigInt(
                                                                a.amountUsd,
                                                            ) < 0n
                                                                ? "var(--bad)"
                                                                : undefined,
                                                    }}
                                                >
                                                    {BigInt(a.amountUsd) < 0n
                                                        ? "-"
                                                        : ""}
                                                    $
                                                    {fmtUsd(
                                                        BigInt(a.amountUsd) < 0n
                                                            ? -BigInt(
                                                                  a.amountUsd,
                                                              )
                                                            : a.amountUsd,
                                                    )}
                                                </td>
                                                <td>
                                                    ${fmtUsd(a.navAfterUsd)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ))}
                    </Card>
                );
            })}
        </div>
    );
}
