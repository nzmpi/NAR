import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, useAction } from "../lib/api";
import { fmtUsd, formatUnits, parseUnits } from "../lib/money";
import type { AdminDeposit, AdminPools, SweepBatch } from "../lib/types";
import {
    Badge,
    Button,
    Card,
    ErrorText,
    Hint,
    Input,
    Segmented,
    Warn,
    Onchain,
    PAGE,
    ShowMore,
} from "../components/ui";

export const NEEDS_ACTION = ["transfer_detected", "ready_to_activate"];
const GROUPS = {
    "needs action": NEEDS_ACTION,
    waiting: ["intent", "awaiting_user_approval"],
    done: ["swept_and_confirmed"],
    closed: ["rejected", "expired", "cancelled"],
    all: [],
} as const;
type Group = keyof typeof GROUPS;
const HASH = /^0x[a-fA-F0-9]{64}$/;
const ADDR = /^0x[a-fA-F0-9]{40}$/;

const lsGet = (k: string) => {
    try {
        return localStorage.getItem(k) ?? "";
    } catch {
        return "";
    }
};
const lsSet = (k: string, v: string) => {
    try {
        localStorage.setItem(k, v);
    } catch {
        /* ignore */
    }
};

export function Deposits() {
    const [group, setGroup] = useState<Group>("needs action");
    const [limit, setLimit] = useState(PAGE);
    const q = useQuery({
        queryKey: ["admin-deposits", limit],
        queryFn: () => api<AdminDeposit[]>(`/admin/deposits?limit=${limit}`),
        refetchInterval: 30_000,
    });
    const pools = useQuery({
        queryKey: ["admin-pools"],
        queryFn: () => api<AdminPools>("/admin/pools"),
    });

    const all = q.data ?? [];
    const inGroup = (d: AdminDeposit, g: Group) =>
        g === "all" ||
        (GROUPS[g] as readonly string[]).includes(d.intent.status);
    const rows = all.filter((d) => inGroup(d, group));

    return (
        <div className="space-y-4">
            {all.some((d) => d.chainId === undefined) && (
                <Warn>
                    The API is an older version without chain IDs, so vault and
                    transaction links are off. Redeploy the backend.
                </Warn>
            )}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <Segmented
                    label="Deposit status"
                    value={group}
                    onChange={setGroup}
                    options={(Object.keys(GROUPS) as Group[]).map((g) => ({
                        id: g,
                        label: g[0].toUpperCase() + g.slice(1),
                        count:
                            g === "all"
                                ? undefined
                                : all.filter((d) => inGroup(d, g)).length,
                    }))}
                />
                <CheckVaults />
            </div>
            {q.isLoading && <Hint>Loading…</Hint>}
            <ErrorText error={q.error} />
            {!q.isLoading && rows.length === 0 && <Hint>Nothing here.</Hint>}
            <div className="space-y-3">
                {rows.map((d) => (
                    <DepositRow
                        key={d.intent.id}
                        d={d}
                        nav={pools.data?.totalAssetsUsd}
                    />
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

type ScanResult = {
    chains: {
        chain: string;
        funded?: number;
        found?: number;
        error?: string;
    }[];
};

function CheckVaults() {
    const qc = useQueryClient();
    const scan = useAction({
        mutationFn: (_, key) =>
            api<ScanResult>("/admin/scan", { method: "POST", key }),
        onSuccess: () => {
            for (const k of ["admin-deposits", "admin-transfers"])
                qc.invalidateQueries({ queryKey: [k] });
        },
    });
    return (
        <div className="flex flex-col items-end gap-1">
            <Button
                title="Reads every vault's balance. Vaults that hold tokens are scanned for new deposits."
                disabled={scan.isPending}
                onClick={() => scan.mutate()}
            >
                {scan.isPending ? "Checking…" : "Check vaults"}
            </Button>
            {scan.data?.chains.map((c) => (
                <p key={c.chain} className="text-right text-xs">
                    {c.chain}:{" "}
                    {c.error ? (
                        <span className="text-[var(--bad)]">{c.error}</span>
                    ) : (
                        `${c.funded} funded vault(s), ${c.found} new transfer(s)`
                    )}
                </p>
            ))}
            <ErrorText error={scan.error} />
        </div>
    );
}

function DepositRow({ d, nav }: { d: AdminDeposit; nav?: string }) {
    const qc = useQueryClient();
    const i = d.intent;
    const [panel, setPanel] = useState<
        "" | "batch" | "sweep" | "activate" | "reject"
    >("");
    const refresh = () => {
        setPanel("");
        for (const k of ["admin-deposits", "admin-pools", "admin-transfers"])
            qc.invalidateQueries({ queryKey: [k] });
    };

    const who = d.username ? `@${d.username}` : d.telegramId;
    const intended = `${formatUnits(i.intendedAmount, d.decimals, 2)} ${d.symbol}`;
    const canReject = [
        "intent",
        "transfer_detected",
        "awaiting_user_approval",
        "ready_to_activate",
    ].includes(i.status);

    return (
        <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="font-semibold">{who}</div>
                    <div className="text-xs text-[var(--hint)]">
                        {new Date(i.createdAt).toLocaleString()}
                    </div>
                </div>
                <Badge status={i.status} />
            </div>
            <Steps status={i.status} />
            <dl className="grid grid-cols-2 gap-3 text-sm tnum sm:grid-cols-4">
                <div>
                    <dt className="text-xs text-[var(--hint)]">Intended</dt>
                    <dd>{intended}</dd>
                </div>
                <div>
                    <dt className="text-xs text-[var(--hint)]">Confirmed</dt>
                    <dd>
                        {i.confirmedAmount
                            ? `${formatUnits(i.confirmedAmount, d.decimals, 2)} ${d.symbol}`
                            : "–"}
                        {i.confirmedAmountUsd &&
                            ` ($${fmtUsd(i.confirmedAmountUsd)})`}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-[var(--hint)]">Vault</dt>
                    <dd>{d.vaultDeployed ? "deployed" : "not deployed"}</dd>
                </div>
                <div>
                    <dt className="text-xs text-[var(--hint)]">Expires</dt>
                    <dd>{new Date(i.expiresAt).toLocaleString()}</dd>
                </div>
            </dl>
            <div className="text-sm">
                <span className="text-[var(--hint)]">Vault address: </span>
                <Onchain value={d.vaultAddress} chainId={d.chainId} />
            </div>
            {i.sweepTxHash && (
                <div className="text-sm">
                    <span className="text-[var(--hint)]">Sweep tx: </span>
                    <Onchain value={i.sweepTxHash} chainId={d.chainId} />
                </div>
            )}
            {i.rejectionReason && (
                <div className="text-sm text-[var(--bad)]">
                    {i.rejectionReason}
                </div>
            )}
            {i.status === "awaiting_user_approval" && (
                <Hint>
                    Waiting for the user to approve the different amount.
                </Hint>
            )}

            <div className="flex flex-wrap gap-2">
                {i.status === "transfer_detected" && (
                    <>
                        <Button
                            onClick={() =>
                                setPanel(panel === "batch" ? "" : "batch")
                            }
                        >
                            1. Safe batch
                        </Button>
                        <Button
                            variant="ghost"
                            onClick={() =>
                                setPanel(panel === "sweep" ? "" : "sweep")
                            }
                        >
                            2. Record sweep
                        </Button>
                    </>
                )}
                {i.status === "ready_to_activate" && (
                    <Button
                        onClick={() =>
                            setPanel(panel === "activate" ? "" : "activate")
                        }
                    >
                        Activate…
                    </Button>
                )}
                {canReject && (
                    <Button
                        variant="danger"
                        onClick={() =>
                            setPanel(panel === "reject" ? "" : "reject")
                        }
                    >
                        Reject…
                    </Button>
                )}
            </div>

            {panel === "batch" && <BatchPanel d={d} />}
            {panel === "sweep" && <SweepPanel d={d} onDone={refresh} />}
            {panel === "activate" && (
                <ActivatePanel d={d} nav={nav} onDone={refresh} />
            )}
            {panel === "reject" && <RejectPanel d={d} onDone={refresh} />}
        </Card>
    );
}

const STEPS = ["Intent", "Transfer detected", "Swept", "Active"];
const STEP_OF: Record<string, number> = {
    intent: 0,
    transfer_detected: 1,
    awaiting_user_approval: 1,
    ready_to_activate: 2,
    swept_and_confirmed: 3,
};

// Where a deposit is in its life: intent -> transfer -> sweep -> active.
function Steps({ status }: { status: string }) {
    const at = STEP_OF[status];
    if (at === undefined) return null; // closed deposits have no progress
    return (
        <ol className="grid grid-cols-4 gap-2" aria-label="Progress">
            {STEPS.map((label, k) => (
                <li
                    key={label}
                    aria-current={k === at ? "step" : undefined}
                    className="flex flex-col gap-1.5"
                >
                    <div
                        className="h-1.5 rounded-full"
                        style={{
                            background: k <= at ? "var(--btn)" : "var(--track)",
                        }}
                    />
                    <span
                        className={`text-xs ${k === at ? "font-semibold text-[var(--fg)]" : "text-[var(--hint)]"}`}
                    >
                        {label}
                    </span>
                </li>
            ))}
        </ol>
    );
}

function BatchPanel({ d }: { d: AdminDeposit }) {
    const [to, setTo] = useState(lsGet("nar.treasury"));
    const [native, setNative] = useState(false);
    const build = useMutation({
        mutationFn: () =>
            api<SweepBatch>(
                `/admin/vaults/${d.intent.vaultId}/sweep-calldata`,
                {
                    method: "POST",
                    body: {
                        to: to.trim(),
                        items: [{ assetId: d.intent.assetId, amount: "max" }],
                        includeNative: native,
                    },
                },
            ),
        onSuccess: () => lsSet("nar.treasury", to.trim()),
    });
    const b = build.data;
    const json = b ? JSON.stringify(b.safeBatch, null, 2) : "";
    const download = () => {
        const url = URL.createObjectURL(
            new Blob([json], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `sweep-${d.vaultAddress.slice(0, 8)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };
    return (
        <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
            <Hint>
                Builds a Safe Transaction Builder batch that sweeps the vault's
                full {d.symbol} balance to your treasury address. An undeployed
                vault is deployed in the same batch.
            </Hint>
            <label className="block text-sm">
                Destination (treasury) address
                <Input
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="0x…"
                    className="mt-1 font-mono"
                />
            </label>
            <label className="flex items-center gap-2 text-sm">
                <input
                    type="checkbox"
                    checked={native}
                    onChange={(e) => setNative(e.target.checked)}
                />{" "}
                Also sweep native coin
            </label>
            <ErrorText error={build.error} />
            <Button
                disabled={!ADDR.test(to.trim()) || build.isPending}
                onClick={() => build.mutate()}
            >
                {build.isPending ? "Building…" : "Build batch"}
            </Button>
            {b && (
                <div className="space-y-2 text-sm">
                    <div>
                        Chain <b>{b.chainId}</b> · to{" "}
                        <Onchain value={b.destination} chainId={b.chainId} />
                    </div>
                    {b.tokens.map((t, k) => (
                        <div key={t}>
                            Token <Onchain value={t} chainId={b.chainId} />:{" "}
                            <b className="tnum">
                                {formatUnits(b.amounts[k], d.decimals, 6)}
                            </b>{" "}
                            {d.symbol}
                        </div>
                    ))}
                    <ul className="list-disc pl-5 text-[var(--hint)]">
                        {b.transactions.map((t, k) => (
                            <li key={k}>{t.description}</li>
                        ))}
                    </ul>
                    <Warn>
                        Signers: verify the destination and amounts in the Safe
                        UI before executing.
                    </Warn>
                    <div className="flex gap-2">
                        <Button onClick={download}>Download JSON</Button>
                        <Button
                            variant="ghost"
                            onClick={() => navigator.clipboard?.writeText(json)}
                        >
                            Copy JSON
                        </Button>
                    </div>
                    <Hint>
                        After the Safe transaction executes, use "2. Record
                        sweep" with its transaction hash.
                    </Hint>
                </div>
            )}
        </div>
    );
}

function SweepPanel({ d, onDone }: { d: AdminDeposit; onDone: () => void }) {
    const [hash, setHash] = useState("");
    const [amt, setAmt] = useState("");
    const parsed = amt ? parseUnits(amt, d.decimals) : undefined;
    const go = useAction({
        mutationFn: (_, key) =>
            api(`/admin/deposits/${d.intent.id}/sweep`, {
                method: "POST",
                key,
                body: {
                    sweepTxHash: hash.trim(),
                    ...(parsed ? { confirmedAmount: parsed.toString() } : {}),
                },
            }),
        onSuccess: onDone,
    });
    return (
        <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
            <Hint>
                The server re-checks the transfer and the sweep transaction
                onchain. Leave the amount empty to use the detected amount.
            </Hint>
            <Input
                placeholder="Sweep tx hash 0x…"
                value={hash}
                onChange={(e) => setHash(e.target.value)}
                className="font-mono"
            />
            <Input
                placeholder={`Confirmed amount in ${d.symbol} (optional)`}
                inputMode="decimal"
                value={amt}
                onChange={(e) => setAmt(e.target.value)}
                className="tnum"
            />
            {amt && parsed === null && (
                <p className="text-sm text-[var(--bad)]">Invalid amount.</p>
            )}
            <ErrorText error={go.error} />
            <Button
                disabled={
                    !HASH.test(hash.trim()) || parsed === null || go.isPending
                }
                onClick={() => go.mutate()}
            >
                {go.isPending ? "Verifying…" : "Record sweep"}
            </Button>
        </div>
    );
}

function ActivatePanel({
    d,
    nav,
    onDone,
}: {
    d: AdminDeposit;
    nav?: string;
    onDone: () => void;
}) {
    const [total, setTotal] = useState(
        nav ? formatUnits(nav, 6, 2).replaceAll(",", "") : "",
    );
    const t6 = parseUnits(total, 6);
    const go = useAction({
        mutationFn: (_, key) =>
            api(`/admin/deposits/${d.intent.id}/activate`, {
                method: "POST",
                key,
                body: { reportedTotalUsd: t6!.toString() },
            }),
        onSuccess: onDone,
    });
    return (
        <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
            <Hint>
                Enter the current total USD value of all managed funds{" "}
                <b>before</b> this deposit. A settlement runs first, then the
                deposit starts earning. The user is notified.
            </Hint>
            <label className="block text-sm">
                Total managed funds, excluding this deposit (USD)
                <Input
                    inputMode="decimal"
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                    className="mt-1 tnum"
                />
            </label>
            <ErrorText error={go.error} />
            <Button
                disabled={t6 === null || go.isPending}
                onClick={() => go.mutate()}
            >
                {go.isPending ? "Activating…" : "Activate deposit"}
            </Button>
        </div>
    );
}

function RejectPanel({ d, onDone }: { d: AdminDeposit; onDone: () => void }) {
    const [reason, setReason] = useState("");
    const go = useAction({
        mutationFn: (_, key) =>
            api(`/admin/deposits/${d.intent.id}/reject`, {
                method: "POST",
                key,
                body: { reason: reason.trim() },
            }),
        onSuccess: onDone,
    });
    return (
        <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
            <Input
                placeholder="Reason"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
            />
            <ErrorText error={go.error} />
            <Button
                variant="danger"
                disabled={!reason.trim() || go.isPending}
                onClick={() => go.mutate()}
            >
                Reject deposit
            </Button>
        </div>
    );
}
