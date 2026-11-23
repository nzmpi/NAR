import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtUsd } from "../lib/money";
import { POOL_NAME, type AdminRelock } from "../lib/types";
import { Badge, Card, ErrorText, Hint, Segmented } from "../components/ui";

const FILTERS = ["pending", "applied", "failed", "cancelled", "all"] as const;

// Read only: users queue relocks in the Mini App and the next settlement
// applies them, so there is nothing for an admin to approve here.
export function Relocks() {
    const [filter, setFilter] = useState<(typeof FILTERS)[number]>("pending");
    const q = useQuery({
        queryKey: ["admin-relocks", filter],
        queryFn: () =>
            api<AdminRelock[]>(
                `/admin/relocks${filter === "all" ? "" : `?status=${filter}`}`,
            ),
        refetchInterval: 30_000,
    });

    return (
        <div className="space-y-4">
            <Segmented
                label="Relock status"
                value={filter}
                onChange={setFilter}
                options={FILTERS.map((f) => ({
                    id: f,
                    label: f[0].toUpperCase() + f.slice(1),
                }))}
            />
            {filter === "pending" && (
                <Hint>
                    Pending relocks are applied automatically at the next
                    settlement.
                </Hint>
            )}
            {q.isLoading && <Hint>Loading…</Hint>}
            <ErrorText error={q.error} />
            {q.data?.length === 0 && <Hint>Nothing here.</Hint>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] items-start gap-3">
                {q.data?.map((r) => (
                    <Row key={r.request.id} r={r} />
                ))}
            </div>
        </div>
    );
}

const pool = (k?: string) => (k ? (POOL_NAME[k] ?? k) : "?");

function Row({ r }: { r: AdminRelock }) {
    const who = r.username ? `@${r.username}` : r.telegramId;
    return (
        <Card className="space-y-3 !p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="font-semibold">{who}</div>
                    <div className="text-xs text-[var(--hint)]">
                        {new Date(r.request.createdAt).toLocaleString()}
                        {r.request.appliedAt &&
                            ` · applied ${new Date(r.request.appliedAt).toLocaleString()}`}
                    </div>
                </div>
                <Badge status={r.request.status} />
            </div>
            <ul className="space-y-2 text-sm tnum">
                {r.items.map((i) => (
                    <li
                        key={i.id}
                        className="rounded-xl border border-[var(--line)] px-3 py-2"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">
                                {pool(i.sourcePool)} → {pool(i.targetPool)}
                            </span>
                            <span className="font-semibold">
                                {i.appliedUsd
                                    ? `$${fmtUsd(i.appliedUsd)}`
                                    : i.isMax
                                      ? `All${i.reservedUsd ? ` (≈ $${fmtUsd(i.reservedUsd)})` : ""}`
                                      : `$${fmtUsd(i.amountUsd ?? "0")}`}
                            </span>
                        </div>
                        {r.items.length > 1 &&
                            i.status !== r.request.status && (
                                <div className="mt-1">
                                    <Badge status={i.status} />
                                </div>
                            )}
                        {i.failureReason && (
                            <div className="mt-1 text-[var(--bad)]">
                                {i.failureReason}
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </Card>
    );
}
