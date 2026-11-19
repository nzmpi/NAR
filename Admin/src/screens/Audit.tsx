import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { AuditEntry } from "../lib/types";
import { ErrorText, Hint, Input, Mono } from "../components/ui";

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
        <div className="space-y-3">
            <Input
                placeholder="Filter by action, entity or details (e.g. withdrawal, vault, a tx hash)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
            />
            <Hint>Latest 200 admin actions. {rows.length} shown.</Hint>
            {q.isLoading && <Hint>Loading…</Hint>}
            <ErrorText error={q.error} />
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="text-left text-[var(--hint)]">
                        <tr>
                            <th className="py-1">Time</th>
                            <th>Admin</th>
                            <th>Action</th>
                            <th>Entity</th>
                            <th>Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr
                                key={r.id}
                                className="border-t border-[var(--line)] align-top"
                            >
                                <td className="whitespace-nowrap py-2 pr-3">
                                    {new Date(r.createdAt).toLocaleString()}
                                </td>
                                <td className="pr-3">{r.adminTelegramId}</td>
                                <td className="pr-3 font-medium">{r.action}</td>
                                <td className="pr-3">
                                    {r.entityType}
                                    {r.entityId && (
                                        <>
                                            {" "}
                                            <Mono>
                                                {r.entityId.slice(0, 8)}
                                            </Mono>
                                        </>
                                    )}
                                </td>
                                <td>
                                    {r.details ? (
                                        <details>
                                            <summary className="cursor-pointer text-[var(--link,var(--btn))]">
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
        </div>
    );
}
