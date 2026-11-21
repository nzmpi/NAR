import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { AuditEntry } from "../lib/types";
import {
    ErrorText,
    Hint,
    Input,
    Mono,
    Pill,
    Select,
    TD,
    TH,
    type Tone,
    Onchain,
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
    const [action, setAction] = useState("");
    const [shown, setShown] = useState<AuditEntry | null>(null);
    const q = useQuery({
        queryKey: ["admin-audit"],
        queryFn: () => api<AuditEntry[]>("/admin/audit"),
        refetchInterval: 60_000,
    });
    const s = search.trim().toLowerCase();
    const actions = [...new Set((q.data ?? []).map((r) => r.action))].sort();
    const rows = (q.data ?? []).filter(
        (r) =>
            (!action || r.action === action) &&
            (!s ||
                r.action.toLowerCase().includes(s) ||
                (r.entityId ?? "").toLowerCase().includes(s) ||
                r.entityType.toLowerCase().includes(s) ||
                JSON.stringify(r.details ?? "")
                    .toLowerCase()
                    .includes(s)),
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
                <Select
                    aria-label="Action"
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                >
                    <option value="">All actions</option>
                    {actions.map((a) => (
                        <option key={a} value={a}>
                            {a}
                        </option>
                    ))}
                </Select>
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
                                    <button
                                        onClick={() => setShown(r)}
                                        className="cursor-pointer font-medium text-[var(--link)] hover:underline"
                                    >
                                        View
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {shown && (
                <DetailsDialog entry={shown} onClose={() => setShown(null)} />
            )}
        </section>
    );
}

// Only numeric EVM chain ids in the details are trusted for links.
const chainOf = (d: unknown) => {
    const c = (d as { chainId?: unknown } | null)?.chainId;
    return typeof c === "number" ? c : undefined;
};

// Modal card for one audit entry. Native <dialog>: Esc closes, focus is trapped.
function DetailsDialog({
    entry: r,
    onClose,
}: {
    entry: AuditEntry;
    onClose: () => void;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => ref.current?.showModal(), []);
    const d = r.details;
    const flat =
        d && typeof d === "object" && !Array.isArray(d)
            ? Object.entries(d as Record<string, unknown>)
            : null;
    const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
        <div className="flex justify-between gap-4 border-b border-[var(--row)] py-2 last:border-b-0">
            <span className="shrink-0 text-[var(--hint)]">{k}</span>
            <span className="min-w-0 text-right break-all">{v}</span>
        </div>
    );
    return (
        <dialog
            ref={ref}
            onClose={onClose}
            onClick={(e) => e.target === ref.current && ref.current.close()}
            aria-labelledby="audit-title"
            className="m-auto w-[min(520px,calc(100vw-32px))] rounded-2xl border border-[var(--line)] bg-[var(--card)] p-0 text-[var(--fg)] shadow-xl backdrop:bg-black/40"
        >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
                <div className="space-y-1.5">
                    <h2
                        id="audit-title"
                        className="display text-[17px] font-semibold"
                    >
                        Audit entry
                    </h2>
                    <Pill tone={toneFor(r.action)}>{r.action}</Pill>
                </div>
                <button
                    aria-label="Close"
                    onClick={() => ref.current?.close()}
                    className="h-8 w-8 cursor-pointer rounded-full bg-[var(--muted-soft)] text-[var(--soft)]"
                >
                    ×
                </button>
            </div>
            <div className="px-5 py-3 text-sm tnum">
                <Row k="Time" v={new Date(r.createdAt).toLocaleString()} />
                <Row k="Admin" v={`tg ${r.adminTelegramId}`} />
                <Row k="Entity" v={r.entityType} />
                {r.entityId && (
                    <Row k="Entity ID" v={<Mono>{r.entityId}</Mono>} />
                )}
                {flat?.map(([k, v]) => (
                    <Row
                        key={k}
                        k={k}
                        v={
                            typeof v === "string" &&
                            /^0x([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(v) ? (
                                <Onchain value={v} chainId={chainOf(d)} />
                            ) : (
                                <Mono>
                                    {typeof v === "string"
                                        ? v
                                        : JSON.stringify(v)}
                                </Mono>
                            )
                        }
                    />
                ))}
                {!flat && d != null && (
                    <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-[var(--bg)] p-3 text-xs whitespace-pre-wrap break-all">
                        {JSON.stringify(d, null, 2)}
                    </pre>
                )}
            </div>
        </dialog>
    );
}
