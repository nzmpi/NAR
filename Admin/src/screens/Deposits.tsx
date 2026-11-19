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
    Mono,
} from "../components/ui";

const GROUPS = {
    "needs action": ["transfer_detected", "ready_to_activate"],
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
    const q = useQuery({
        queryKey: ["admin-deposits"],
        queryFn: () => api<AdminDeposit[]>("/admin/deposits"),
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
            <div className="flex flex-wrap gap-1">
                {(Object.keys(GROUPS) as Group[]).map((g) => (
                    <button
                        key={g}
                        onClick={() => setGroup(g)}
                        className={`rounded-full px-3 py-1 text-sm ${g === group ? "bg-[var(--btn)] text-[var(--btn-fg)]" : "text-[var(--hint)]"}`}
                    >
                        {g}{" "}
                        {g !== "all" && (
                            <span className="opacity-70">
                                ({all.filter((d) => inGroup(d, g)).length})
                            </span>
                        )}
                    </button>
                ))}
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
        <Card className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="font-medium">
                    {who}{" "}
                    <span className="text-sm font-normal text-[var(--hint)]">
                        · {new Date(i.createdAt).toLocaleString()}
                    </span>
                </div>
                <Badge status={i.status} />
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm tnum sm:grid-cols-4">
                <div>
                    <dt className="text-[var(--hint)]">Intended</dt>
                    <dd>{intended}</dd>
                </div>
                <div>
                    <dt className="text-[var(--hint)]">Confirmed</dt>
                    <dd>
                        {i.confirmedAmount
                            ? `${formatUnits(i.confirmedAmount, d.decimals, 2)} ${d.symbol}`
                            : "–"}
                        {i.confirmedAmountUsd &&
                            ` ($${fmtUsd(i.confirmedAmountUsd)})`}
                    </dd>
                </div>
                <div>
                    <dt className="text-[var(--hint)]">Vault</dt>
                    <dd>{d.vaultDeployed ? "deployed" : "not deployed"}</dd>
                </div>
                <div>
                    <dt className="text-[var(--hint)]">Expires</dt>
                    <dd>{new Date(i.expiresAt).toLocaleString()}</dd>
                </div>
            </dl>
            <div className="text-sm">
                <span className="text-[var(--hint)]">Vault address: </span>
                <Mono>{d.vaultAddress}</Mono>
            </div>
            {i.sweepTxHash && (
                <div className="text-sm">
                    <span className="text-[var(--hint)]">Sweep tx: </span>
                    <Mono>{i.sweepTxHash}</Mono>
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
        <div className="space-y-2 rounded-lg border border-[var(--line)] p-3">
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
                        <Mono>{b.destination}</Mono>
                    </div>
                    {b.tokens.map((t, k) => (
                        <div key={t}>
                            Token <Mono>{t}</Mono>:{" "}
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
                    <p className="text-[var(--warn)]">
                        Signers: verify the destination and amounts in the Safe
                        UI before executing.
                    </p>
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
        <div className="space-y-2 rounded-lg border border-[var(--line)] p-3">
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
        <div className="space-y-2 rounded-lg border border-[var(--line)] p-3">
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
        <div className="space-y-2 rounded-lg border border-[var(--line)] p-3">
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
