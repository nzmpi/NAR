import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtUsd, formatUnits } from "../lib/money";
import { POOL_LABEL, type Intent } from "../lib/types";
import { useAssets, useRelocks, useWithdrawals } from "../lib/queries";
import {
    Button,
    ErrorText,
    Header,
    Segmented,
    Skeleton,
    statusOf,
} from "../components/ui";

type Kind = "deposit" | "withdrawal" | "relock";
interface Item {
    key: string;
    t: string;
    kind: Kind;
    title: string;
    amount: string;
    gain?: boolean;
    status: string;
    note?: string;
    problem?: string; // rejection or failure reason
    details: (readonly [string, ReactNode])[]; // shown in the popup
    cancel?: { label: string; run: (done: () => void) => void };
}

const FILTERS = [
    { id: "all", label: "All" },
    { id: "deposit", label: "Deposits" },
    { id: "withdrawal", label: "Withdrawals" },
    { id: "relock", label: "Relocks" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

const ICON: Record<Kind, string> = {
    deposit: "M12 5v14M6 13l6 6 6-6",
    withdrawal: "M12 19V5M6 11l6-6 6 6",
    relock: "M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M18 3v4h-4M6 21v-4h4",
};
const ICON_TONE = {
    good: "bg-[var(--good-soft)] text-[var(--good)]",
    warn: "bg-[var(--warn-soft)] text-[var(--warn)]",
    bad: "bg-[var(--bad-soft)] text-[var(--bad)]",
    muted: "bg-[var(--muted-soft)] text-[var(--soft)]",
};

const DAY = 86_400_000;
function bucket(t: string) {
    const d = new Date(t);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    if (d >= start) return "Today";
    if (d.getTime() >= start.getTime() - 6 * DAY) return "This week";
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
const when = (t: string) =>
    bucket(t) === "Today"
        ? new Date(t).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
          })
        : new Date(t).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
          });

const full = (t: string) =>
    new Date(t).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });
const Mono = ({ children }: { children: string }) => (
    <span className="font-mono text-xs break-all">{children}</span>
);

export function History() {
    const qc = useQueryClient();
    const [filter, setFilter] = useState<Filter>("all");
    const [openKey, setOpenKey] = useState<string | null>(null);
    const assets = useAssets();
    const deposits = useQuery({
        queryKey: ["deposits"],
        queryFn: () => api<Intent[]>("/me/deposits"),
    });
    const wd = useWithdrawals();
    const rl = useRelocks();
    const refresh = () => {
        for (const k of ["portfolio", "withdrawals", "relocks"])
            qc.invalidateQueries({ queryKey: [k] });
    };
    const cancelW = useMutation({
        mutationFn: (id: string) =>
            api(`/me/withdrawals/${id}/cancel`, { method: "POST" }),
        onSuccess: refresh,
    });
    const cancelR = useMutation({
        mutationFn: (id: string) =>
            api(`/me/relocks/${id}/cancel`, { method: "POST" }),
        onSuccess: refresh,
    });

    const header = (
        <Header title="History">
            <Segmented
                label="Show"
                options={FILTERS}
                value={filter}
                onChange={setFilter}
                onHero
                className="mt-1.5"
            />
        </Header>
    );
    if (assets.isLoading || deposits.isLoading || wd.isLoading || rl.isLoading)
        return (
            <div className="flex flex-col gap-3">
                {header}
                <Skeleton header={false} />
            </div>
        );
    const err = assets.error || deposits.error || wd.error || rl.error;
    if (err)
        return (
            <div className="flex flex-col gap-3">
                {header}
                <ErrorText error={err} />
            </div>
        );

    const busy = cancelW.isPending || cancelR.isPending;
    const items: Item[] = [
        ...deposits
            .data!.filter(
                (d) => d.status !== "cancelled" && d.status !== "expired",
            )
            .map((d): Item => {
                const a = assets.data!.find((x) => x.assetId === d.assetId);
                const units = (v: string) =>
                    `${formatUnits(v, a?.decimals ?? 6, 2)} ${a?.symbol ?? ""}`;
                const split = d.allocations
                    .map(
                        (x) =>
                            `${POOL_LABEL[x.pool] ?? "Manager"} ${x.bps / 100}%`,
                    )
                    .join(", ");
                return {
                    key: "d" + d.id,
                    t: d.createdAt,
                    kind: "deposit",
                    title: "Deposit",
                    status: d.status,
                    amount: d.confirmedAmountUsd
                        ? `+$${fmtUsd(d.confirmedAmountUsd)}`
                        : units(d.intendedAmount),
                    gain: !!d.confirmedAmountUsd,
                    note: split,
                    problem: d.rejectionReason ?? undefined,
                    details: [
                        ["Created", full(d.createdAt)],
                        ["Amount to send", units(d.intendedAmount)],
                        ...(d.confirmedAmount
                            ? [["Received", units(d.confirmedAmount)] as const]
                            : []),
                        ...(d.confirmedAmountUsd
                            ? [
                                  [
                                      "Credited",
                                      `$${fmtUsd(d.confirmedAmountUsd)}`,
                                  ] as const,
                              ]
                            : []),
                        ["Network", a?.chainName ?? "—"],
                        ["Split", split],
                        ...(d.status === "intent"
                            ? [["Valid until", full(d.expiresAt)] as const]
                            : []),
                    ],
                };
            }),
        ...wd.data!.map((w): Item => {
            const a = assets.data!.find((x) => x.assetId === w.assetId);
            return {
                key: "w" + w.id,
                t: w.createdAt,
                kind: "withdrawal",
                title: "Withdrawal",
                status: w.status,
                amount: `−$${fmtUsd(w.grossAmountUsd)}`,
                note:
                    BigInt(w.earlyFeeUsd) > 0n
                        ? `fee $${fmtUsd(w.earlyFeeUsd)}`
                        : w.status === "pending" && w.lockedAt
                          ? "payout in progress"
                          : undefined,
                problem:
                    w.status === "rejected"
                        ? (w.rejectionReason ?? undefined)
                        : undefined,
                details: [
                    ["Requested", full(w.createdAt)],
                    ["Amount", `$${fmtUsd(w.grossAmountUsd)}`],
                    ["Early fee", `$${fmtUsd(w.earlyFeeUsd)}`],
                    ["You receive", `$${fmtUsd(w.netPayoutUsd)}`],
                    [
                        "Payout",
                        `${formatUnits(w.payoutAmount, a?.decimals ?? 6, 2)} ${a?.symbol ?? ""}`,
                    ],
                    ["Network", a?.chainName ?? "—"],
                    ["To", <Mono>{w.destinationAddress}</Mono>],
                    ...(w.processedAt
                        ? [["Paid", full(w.processedAt)] as const]
                        : []),
                    ...(w.txHash
                        ? [["Transaction", <Mono>{w.txHash}</Mono>] as const]
                        : []),
                ],
                // Once the payout is locked it can no longer be cancelled.
                cancel:
                    w.status === "pending" && !w.lockedAt
                        ? {
                              label: "Cancel withdrawal",
                              run: (done) =>
                                  cancelW.mutate(w.id, { onSuccess: done }),
                          }
                        : undefined,
            };
        }),
        ...rl.data!.map((r): Item => ({
            key: "r" + r.id,
            t: r.createdAt,
            kind: "relock",
            title: "Relock",
            status: r.status,
            amount: r.items.some((i) => i.isMax)
                ? "all"
                : r.items.some((i) => i.amountUsd)
                  ? `$${fmtUsd(r.items.reduce((s, i) => s + BigInt(i.amountUsd ?? 0), 0n))}`
                  : "",
            note:
                "into " +
                r.items
                    .map((i) => (i.targetPool ? POOL_LABEL[i.targetPool] : ""))
                    .join(", "),
            problem:
                r.items.find((i) => i.failureReason)?.failureReason ??
                undefined,
            details: [
                ["Requested", full(r.createdAt)],
                ...(r.appliedAt
                    ? [["Applied", full(r.appliedAt)] as const]
                    : []),
                ...r.items.map((i): [string, ReactNode] => [
                    `Into ${i.targetPool ? POOL_LABEL[i.targetPool] : "—"}`,
                    <span className="flex flex-col items-end">
                        <span>
                            {i.appliedUsd
                                ? `$${fmtUsd(i.appliedUsd)}`
                                : i.isMax
                                  ? "All"
                                  : `$${fmtUsd(i.amountUsd ?? "0")}`}{" "}
                            · {statusOf(i.status)[0]}
                        </span>
                        {i.failureReason && (
                            <span className="text-xs text-[var(--bad)]">
                                {i.failureReason}
                            </span>
                        )}
                    </span>,
                ]),
            ],
            cancel:
                r.status === "pending"
                    ? {
                          label: "Cancel relock",
                          run: (done) =>
                              cancelR.mutate(r.id, { onSuccess: done }),
                      }
                    : undefined,
        })),
    ]
        .filter((x) => filter === "all" || x.kind === filter)
        .sort((a, b) => b.t.localeCompare(a.t));

    const groups: { label: string; items: Item[] }[] = [];
    for (const it of items) {
        const label = bucket(it.t);
        const g = groups.at(-1);
        if (g?.label === label) g.items.push(it);
        else groups.push({ label, items: [it] });
    }

    const open = items.find((x) => x.key === openKey);
    return (
        <div className="flex flex-col gap-2.5">
            {header}
            {open && (
                <Details
                    item={open}
                    busy={busy}
                    error={cancelW.error || cancelR.error}
                    onClose={() => setOpenKey(null)}
                />
            )}
            {!items.length && (
                <p className="my-5 text-center text-[var(--hint)]">
                    Nothing here yet.
                </p>
            )}
            {groups.map((g) => (
                <section key={g.label} className="flex flex-col gap-2">
                    <h2 className="mx-1 mt-2 text-xs font-semibold tracking-wider text-[var(--hint)] uppercase">
                        {g.label}
                    </h2>
                    <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--card)]">
                        {g.items.map((it, k) => {
                            const [label, tone] = statusOf(it.status);
                            return (
                                <button
                                    key={it.key}
                                    onClick={() => setOpenKey(it.key)}
                                    className={`flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left active:bg-[var(--row)] ${k ? "border-t border-[var(--row)]" : ""}`}
                                >
                                    <span
                                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${it.kind === "relock" ? "bg-[color-mix(in_srgb,var(--t3)_14%,transparent)] text-[var(--t3)]" : ICON_TONE[tone]}`}
                                    >
                                        <svg
                                            width="18"
                                            height="18"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2.2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            aria-hidden="true"
                                        >
                                            <path d={ICON[it.kind]} />
                                        </svg>
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block font-semibold">
                                            {it.title}
                                        </span>
                                        <span className="block truncate text-xs text-[var(--hint)]">
                                            {when(it.t)}
                                            {it.note && ` · ${it.note}`}
                                        </span>
                                        {it.problem && (
                                            <span className="block text-xs text-[var(--bad)]">
                                                {it.problem}
                                            </span>
                                        )}
                                    </span>
                                    <span className="flex flex-col items-end gap-0.5 text-right">
                                        <span
                                            className={`font-semibold ${it.gain ? "text-[var(--good)]" : ""}`}
                                        >
                                            {it.amount}
                                        </span>
                                        <span
                                            className={`text-xs font-medium ${tone === "warn" ? "text-[var(--warn)]" : tone === "bad" ? "text-[var(--bad)]" : "text-[var(--hint)]"}`}
                                        >
                                            {label}
                                        </span>
                                        {it.cancel && (
                                            <span className="text-xs text-[var(--hint)]">
                                                Can be cancelled
                                            </span>
                                        )}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </section>
            ))}
        </div>
    );
}

// Bottom sheet with everything we know about one action. Native <dialog> gives Esc, focus trap and a backdrop.
function Details({
    item,
    busy,
    error,
    onClose,
}: {
    item: Item;
    busy: boolean;
    error: unknown;
    onClose: () => void;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => ref.current?.showModal(), []);
    const [label, tone] = statusOf(item.status);
    return (
        <dialog
            ref={ref}
            onClose={onClose}
            onClick={(e) => e.target === ref.current && ref.current.close()}
            aria-label={`${item.title} details`}
            className="mx-auto mt-auto mb-0 max-h-[85vh] w-full max-w-[520px] rounded-t-[24px] bg-[var(--card)] text-[var(--fg)] backdrop:bg-black/45"
        >
            <div className="flex flex-col gap-4 p-5 pb-7">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-bold">{item.title}</h2>
                        <p
                            className={`text-sm font-medium ${tone === "warn" ? "text-[var(--warn)]" : tone === "bad" ? "text-[var(--bad)]" : tone === "good" ? "text-[var(--good)]" : "text-[var(--hint)]"}`}
                        >
                            {label}
                        </p>
                    </div>
                    <span
                        className={`text-xl font-bold ${item.gain ? "text-[var(--good)]" : ""}`}
                    >
                        {item.amount}
                    </span>
                </div>
                {item.problem && (
                    <p className="rounded-xl bg-[var(--bad-soft)] px-3 py-2 text-sm text-[var(--bad)]">
                        {item.problem}
                    </p>
                )}
                <dl className="flex flex-col">
                    {item.details.map(([k, v], n) => (
                        <div
                            key={n}
                            className="flex justify-between gap-4 border-t border-[var(--row)] py-2.5 text-sm first:border-t-0"
                        >
                            <dt className="shrink-0 text-[var(--hint)]">{k}</dt>
                            <dd className="min-w-0 text-right">{v}</dd>
                        </div>
                    ))}
                </dl>
                <ErrorText error={error} />
                {item.cancel && (
                    <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => item.cancel!.run(onClose)}
                    >
                        {busy ? "Cancelling…" : item.cancel.label}
                    </Button>
                )}
                <Button variant="ghost" onClick={() => ref.current?.close()}>
                    Close
                </Button>
            </div>
        </dialog>
    );
}
