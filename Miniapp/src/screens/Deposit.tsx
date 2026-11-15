import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, newKey } from "../lib/api";
import { fmtUsd, formatUnits, parseUnits } from "../lib/money";
import {
    POOL_APY_BPS,
    POOL_LABEL,
    USER_POOLS,
    type Asset,
    type Intent,
    type PoolKey,
    type Vault,
} from "../lib/types";
import { bpsPct } from "../lib/money";
import { Button, Card, ErrorText, Hint, StatusBadge } from "../components/ui";

const MIN_USD = 50;
const ACTIVE = [
    "intent",
    "transfer_detected",
    "awaiting_user_approval",
    "ready_to_activate",
];

export function Deposit() {
    const assets = useQuery({
        queryKey: ["assets"],
        queryFn: () => api<Asset[]>("/assets"),
    });
    const vaults = useQuery({
        queryKey: ["vaults"],
        queryFn: () => api<Vault[]>("/me/vaults"),
    });
    const intents = useQuery({
        queryKey: ["deposits"],
        queryFn: () => api<Intent[]>("/me/deposits"),
        refetchInterval: 30_000,
    });

    if (assets.isLoading || vaults.isLoading || intents.isLoading)
        return <Hint>Loading…</Hint>;
    const err = assets.error || vaults.error || intents.error;
    if (err) return <ErrorText error={err} />;

    const list = intents.data!;
    const active = list.filter((i) => ACTIVE.includes(i.status));
    const past = list.filter((i) => !ACTIVE.includes(i.status)).slice(0, 5);
    const ctx = { assets: assets.data!, vaults: vaults.data! };

    return (
        <div className="space-y-4">
            {active.map((i) => (
                <IntentCard key={i.id} intent={i} {...ctx} />
            ))}
            <NewDeposit {...ctx} />
            {past.length > 0 && (
                <div>
                    <h2 className="font-medium mb-2">Recent</h2>
                    <div className="space-y-2">
                        {past.map((i) => (
                            <IntentCard
                                key={i.id}
                                intent={i}
                                {...ctx}
                                compact
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function NewDeposit({ assets, vaults }: { assets: Asset[]; vaults: Vault[] }) {
    const qc = useQueryClient();
    const key = useRef(newKey());
    const [assetId, setAssetId] = useState(assets[0]?.assetId ?? "");
    const [amount, setAmount] = useState("");
    const [alloc, setAlloc] = useState<Record<PoolKey, string>>({
        liquid: "100",
        lock_1m: "",
        lock_2m: "",
        lock_3m: "",
    });

    const asset = assets.find((a) => a.assetId === assetId);
    const vault =
        asset &&
        vaults
            .filter((v) => v.chainUuid === asset.chainUuid)
            .sort((a, b) => a.nonce - b.nonce)[0];
    const units = asset ? parseUnits(amount, asset.decimals) : null;
    const usdOk =
        asset &&
        units !== null &&
        units >= BigInt(MIN_USD) * 10n ** BigInt(asset.decimals);
    const parts = USER_POOLS.map((p) => ({
        pool: p,
        pct: Number(alloc[p] || 0),
    }));
    const total = parts.reduce((s, x) => s + x.pct, 0);
    const valid = parts.every(
        (x) => Number.isInteger(x.pct) && x.pct >= 0 && x.pct <= 100,
    );
    const canSubmit = !!asset && !!vault && !!usdOk && valid && total === 100;

    const create = useMutation({
        mutationFn: () =>
            api<Intent>("/me/deposits/intents", {
                method: "POST",
                idempotencyKey: key.current,
                body: {
                    vaultId: vault!.id,
                    assetId,
                    intendedAmount: units!.toString(),
                    allocations: parts
                        .filter((x) => x.pct > 0)
                        .map((x) => ({ pool: x.pool, bps: x.pct * 100 })),
                },
            }),
        onSuccess: () => {
            key.current = newKey();
            setAmount("");
            qc.invalidateQueries({ queryKey: ["deposits"] });
            qc.invalidateQueries({ queryKey: ["portfolio"] });
        },
    });

    if (!assets.length)
        return (
            <Card>
                <Hint>Deposits are not available yet.</Hint>
            </Card>
        );

    return (
        <Card className="space-y-3">
            <h2 className="font-medium">New deposit</h2>
            <label className="block">
                <Hint>Network and token</Hint>
                <select
                    value={assetId}
                    onChange={(e) => setAssetId(e.target.value)}
                    className="w-full mt-1 rounded-xl p-3 bg-[var(--bg)]"
                >
                    {assets.map((a) => (
                        <option key={a.assetId} value={a.assetId}>
                            {a.chainName} · {a.symbol}
                        </option>
                    ))}
                </select>
            </label>
            <label className="block">
                <Hint>Amount (minimum ${MIN_USD})</Hint>
                <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="100"
                    className="w-full mt-1 rounded-xl p-3 bg-[var(--bg)] tnum"
                />
            </label>
            <div>
                <Hint>Split between tiers (whole percent, must total 100)</Hint>
                <div className="space-y-2 mt-1">
                    {USER_POOLS.map((p) => (
                        <div key={p} className="flex items-center gap-3">
                            <span className="flex-1">
                                {POOL_LABEL[p]}{" "}
                                <span className="text-[var(--hint)]">
                                    · {bpsPct(POOL_APY_BPS[p])}
                                </span>
                            </span>
                            <input
                                inputMode="numeric"
                                value={alloc[p]}
                                onChange={(e) =>
                                    setAlloc({
                                        ...alloc,
                                        [p]: e.target.value
                                            .replace(/\D/g, "")
                                            .slice(0, 3),
                                    })
                                }
                                placeholder="0"
                                className="w-20 rounded-xl p-2 bg-[var(--bg)] text-right tnum"
                            />
                            <span className="text-[var(--hint)]">%</span>
                        </div>
                    ))}
                </div>
                <div
                    className="text-sm mt-2"
                    style={{
                        color: total === 100 ? "var(--good)" : "var(--warn)",
                    }}
                >
                    Total {total}%
                </div>
                <p className="text-xs text-[var(--hint)] mt-1">
                    Locked tiers pay more but charge a 10% fee on early
                    withdrawal.
                </p>
            </div>
            <ErrorText error={create.error} />
            <Button
                className="w-full"
                disabled={!canSubmit || create.isPending}
                onClick={() => create.mutate()}
            >
                {create.isPending ? "Creating…" : "Get deposit address"}
            </Button>
        </Card>
    );
}

function IntentCard({
    intent: i,
    assets,
    vaults,
    compact,
}: {
    intent: Intent;
    assets: Asset[];
    vaults: Vault[];
    compact?: boolean;
}) {
    const qc = useQueryClient();
    const [hash, setHash] = useState("");
    const [msg, setMsg] = useState("");
    const asset = assets.find((a) => a.assetId === i.assetId);
    const vault = vaults.find((v) => v.id === i.vaultId);
    const refresh = () => {
        qc.invalidateQueries({ queryKey: ["deposits"] });
        qc.invalidateQueries({ queryKey: ["portfolio"] });
    };

    const check = useMutation({
        mutationFn: () =>
            api<{ transfers: number; attached: number }>(
                `/me/deposits/intents/${i.id}/check`,
                { method: "POST" },
            ),
        onSuccess: (r) => {
            setMsg(
                r.attached > 0
                    ? "Transfer found. The team will confirm it shortly."
                    : "Nothing found yet. It can take a few minutes.",
            );
            refresh();
        },
    });
    const attach = useMutation({
        mutationFn: () =>
            api(`/me/deposits/intents/${i.id}/tx-hash`, {
                method: "POST",
                body: { txHash: hash.trim() },
            }),
        onSuccess: () => {
            setHash("");
            setMsg("Transaction submitted.");
            refresh();
        },
    });
    const approve = useMutation({
        mutationFn: () =>
            api(`/me/deposits/intents/${i.id}/approve-amount`, {
                method: "POST",
            }),
        onSuccess: refresh,
    });
    const cancel = useMutation({
        mutationFn: () =>
            api(`/me/deposits/intents/${i.id}/cancel`, { method: "POST" }),
        onSuccess: refresh,
    });

    const dec = asset?.decimals ?? 6;
    const sym = asset?.symbol ?? "";
    const intended = formatUnits(i.intendedAmount, dec, 2);

    if (compact) {
        return (
            <Card className="flex justify-between items-center">
                <span className="tnum">
                    {intended} {sym}
                </span>
                <StatusBadge status={i.status} />
            </Card>
        );
    }

    return (
        <Card className="space-y-3">
            <div className="flex justify-between items-center">
                <span className="font-medium tnum">
                    {intended} {sym}
                </span>
                <StatusBadge status={i.status} />
            </div>

            {i.status === "intent" && vault && asset && (
                <>
                    <p className="text-sm">
                        Send{" "}
                        <b className="tnum">
                            {intended} {sym}
                        </b>{" "}
                        on <b>{asset.chainName}</b> to this address. Use only
                        this network and token. Valid until{" "}
                        {new Date(i.expiresAt).toLocaleString()}.
                    </p>
                    <div className="rounded-xl bg-[var(--bg)] p-3 break-all text-sm font-mono">
                        {vault.address}
                    </div>
                    <Button
                        variant="ghost"
                        className="w-full"
                        onClick={() =>
                            navigator.clipboard
                                ?.writeText(vault.address)
                                .then(() => setMsg("Address copied."))
                        }
                    >
                        Copy address
                    </Button>
                    {!vault.isDeployed && (
                        <p className="text-xs text-[var(--hint)]">
                            Your vault is created when your deposit is
                            processed. It is safe to send before that.
                        </p>
                    )}
                    <Button
                        className="w-full"
                        disabled={check.isPending}
                        onClick={() => check.mutate()}
                    >
                        {check.isPending ? "Checking…" : "I sent it"}
                    </Button>
                    <details className="text-sm">
                        <summary className="text-[var(--link)] cursor-pointer">
                            Not detected? Enter the transaction hash
                        </summary>
                        <div className="flex gap-2 mt-2">
                            <input
                                value={hash}
                                onChange={(e) => setHash(e.target.value)}
                                placeholder="0x…"
                                className="flex-1 min-w-0 rounded-xl p-2 bg-[var(--bg)] font-mono text-xs"
                            />
                            <Button
                                disabled={
                                    !/^0x[a-fA-F0-9]{64}$/.test(hash.trim()) ||
                                    attach.isPending
                                }
                                onClick={() => attach.mutate()}
                            >
                                Send
                            </Button>
                        </div>
                    </details>
                    <Button
                        variant="danger"
                        className="w-full"
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate()}
                    >
                        Cancel deposit
                    </Button>
                </>
            )}

            {i.status === "transfer_detected" && (
                <p className="text-sm">
                    We see your transfer. It will be confirmed shortly.
                </p>
            )}

            {i.status === "awaiting_user_approval" && (
                <>
                    <p className="text-sm">
                        You planned{" "}
                        <b className="tnum">
                            {intended} {sym}
                        </b>{" "}
                        but{" "}
                        <b className="tnum">
                            {i.confirmedAmount
                                ? formatUnits(i.confirmedAmount, dec, 2)
                                : "?"}{" "}
                            {sym}
                        </b>{" "}
                        arrived
                        {i.confirmedAmountUsd && (
                            <> (${fmtUsd(i.confirmedAmountUsd)})</>
                        )}
                        . Approve to continue with the received amount.
                    </p>
                    <Button
                        className="w-full"
                        disabled={approve.isPending}
                        onClick={() => approve.mutate()}
                    >
                        Approve received amount
                    </Button>
                </>
            )}

            {i.status === "ready_to_activate" && (
                <p className="text-sm">
                    Funds confirmed. Your deposit starts earning once it is
                    activated.
                </p>
            )}

            {msg && <p className="text-sm text-[var(--hint)]">{msg}</p>}
            <ErrorText
                error={
                    check.error || attach.error || approve.error || cancel.error
                }
            />
        </Card>
    );
}
