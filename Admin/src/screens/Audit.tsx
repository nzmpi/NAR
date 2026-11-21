import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { AuditEntry } from "../lib/types";
import {
    ErrorText,
    Hint,
    Input,
    Mono,
    Pill,
    TD,
    TH,
    type Tone,
} from "../components/ui";

// Color only hints at the outcome; the action text stays the source of truth.
const toneFor = (a: string): Tone =>
    /reject|block|remove|disable|cancel/.test(a)
        ? "bad"
        : /paid|activat|sweep|deploy|unblock|enable/.test(a)
          ? "good"
          : /settle/.test(a)
            ? "accent"
            : "muted";

export function Audit() {
    const [search, setSearch] = useState("");
    const q = useQuery({
        queryKey: ["admin-audit"],
        queryFn: () => api<AuditEntry[]>("/admin/audit"),
        refetchInterval: 60_000,
    });
    const s = search.trim().toLowerCase();
    const rows = (q.data ?? []).filter(
        (r) =>
            !s ||
            r.action.toLowerCase().includes(s) ||
            (r.entityId ?? "").toLowerCase().includes(s) ||
            r.entityType.toLowerCase().includes(s) ||
            JSON.stringify(r.details ?? "")
                .toLowerCase()
                .includes(s),
    );

    return (
        <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
            <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--line)] p-4">
                <Input
                    aria-label="Filter"
                    placeholder="Filter by action, entity or details (e.g. withdrawal, vault, a tx hash)"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="min-w-0 flex-[1_1_320px] !rounded-full px-4"
                />
                <span className="text-[13px] text-[var(--hint)]">
                    Latest 200 admin actions · {rows.length} shown
                </span>
            </div>
            {q.isLoading && (
                <div className="p-5">
                    <Hint>Loading…</Hint>
                </div>
            )}
            <div className="px-5">
                <ErrorText error={q.error} />
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse">
                    <thead>
                        <tr>
                            <th className={TH}>Time</th>
                            <th className={TH}>Admin</th>
                            <th className={TH}>Action</th>
                            <th className={TH}>Entity</th>
                            <th className={TH}>Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr
                                key={r.id}
                                className="border-t border-[var(--row)] align-top"
                            >
                                <td
                                    className={`${TD} whitespace-nowrap text-[var(--soft)] tnum`}
                                >
                                    {new Date(r.createdAt).toLocaleString()}
                                </td>
                                <td className={`${TD} whitespace-nowrap`}>
                                    tg {r.adminTelegramId}
                                </td>
                                <td className={TD}>
                                    <Pill tone={toneFor(r.action)}>
                                        {r.action}
                                    </Pill>
                                </td>
                                <td className={`${TD} whitespace-nowrap`}>
                                    <span className="text-[var(--soft)]">
                                        {r.entityType}
                                    </span>
                                    {r.entityId && (
                                        <>
                                            {" "}
                                            <Mono>
                                                {r.entityId.slice(0, 8)}
                                            </Mono>
                                        </>
                                    )}
                                </td>
                                <td className={TD}>
                                    {r.details ? (
                                        <details>
                                            <summary className="cursor-pointer font-medium text-[var(--link)]">
                                                view
                                            </summary>
                                            <pre className="mt-1 max-w-md whitespace-pre-wrap break-all text-xs">
                                                {JSON.stringify(
                                                    r.details,
                                                    null,
                                                    2,
                                                )}
                                            </pre>
                                        </details>
                                    ) : (
                                        "–"
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
