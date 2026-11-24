import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, useAction } from "../lib/api";
import type { AccessRequest } from "../lib/types";
import {
    Badge,
    Button,
    Card,
    ErrorText,
    Hint,
    PAGE,
    Segmented,
    ShowMore,
} from "../components/ui";

const FILTERS = ["pending", "approved", "rejected", "all"] as const;

// People not on the allowlist ask for access from the bot or the Mini App.
// Approve adds them to the allowlist; they get a bot message either way.
export function Access() {
    const [filter, setFilter] = useState<(typeof FILTERS)[number]>("pending");
    const [limit, setLimit] = useState(PAGE);
    const q = useQuery({
        queryKey: ["admin-access", filter, limit],
        queryFn: () =>
            api<AccessRequest[]>(
                `/admin/access-requests?limit=${limit}${filter === "all" ? "" : `&status=${filter}`}`,
            ),
        refetchInterval: 30_000,
    });

    return (
        <div className="space-y-4">
            <Segmented
                label="Request status"
                value={filter}
                onChange={setFilter}
                options={FILTERS.map((f) => ({
                    id: f,
                    label: f[0].toUpperCase() + f.slice(1),
                }))}
            />
            {filter === "pending" && (
                <Hint>
                    Approving adds the person to the allowlist. A rejected
                    person can ask again after 30 days.
                </Hint>
            )}
            {q.isLoading && <Hint>Loading…</Hint>}
            <ErrorText error={q.error} />
            {q.data?.length === 0 && <Hint>Nothing here.</Hint>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] items-start gap-3">
                {q.data?.map((r) => (
                    <Row key={r.telegramId} r={r} />
                ))}
            </div>
            <ShowMore
                count={q.data?.length ?? 0}
                limit={limit}
                onMore={() => setLimit(limit + PAGE)}
            />
        </div>
    );
}

function Row({ r }: { r: AccessRequest }) {
    const qc = useQueryClient();
    const decide = useAction({
        mutationFn: (action: "approve" | "reject", key) =>
            api(`/admin/access-requests/${r.telegramId}/${action}`, {
                method: "POST",
                key,
            }),
        onSuccess: () => {
            for (const k of ["admin-access", "admin-allowlist"])
                qc.invalidateQueries({ queryKey: [k] });
        },
    });
    const name = [r.firstName, r.username && `@${r.username}`]
        .filter(Boolean)
        .join(" · ");

    return (
        <Card className="space-y-3 !p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="font-semibold">{name || "No name"}</div>
                    <div className="text-xs text-[var(--hint)]">
                        tg {r.telegramId} · asked{" "}
                        {new Date(r.requestedAt).toLocaleString()}
                        {r.decidedAt &&
                            ` · decided ${new Date(r.decidedAt).toLocaleString()}`}
                    </div>
                </div>
                <Badge status={r.status} />
            </div>
            {r.status === "pending" && (
                <div className="flex gap-2">
                    <Button
                        disabled={decide.isPending}
                        onClick={() => decide.mutate("approve")}
                    >
                        Approve
                    </Button>
                    <Button
                        variant="danger"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate("reject")}
                    >
                        Reject
                    </Button>
                </div>
            )}
            <ErrorText error={decide.error} />
        </Card>
    );
}
