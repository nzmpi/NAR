import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, newKey } from "../lib/api";
import { bpsPct, fmtUsd, formatUnits, parseUnits } from "../lib/money";
import { fromBps, splitBps, type AllocMode } from "../lib/alloc";
import {
    POOL_APY_BPS,
    POOL_LABEL,
    USER_POOLS,
    type Asset,
    type Intent,
    type PoolKey,
    type Vault,
} from "../lib/types";
import {
    Button,
    Card,
    Chip,
    ErrorText,
    Field,
    Header,
    Hint,
    Input,
    Segmented,
    Skeleton,
    Select,
    StatusBadge,
    TIER_COLOR,
} from "../components/ui";

const MIN_USD = 50;
const ACTIVE = [
    "intent",
    "transfer_detected",
    "awaiting_user_approval",
    "ready_to_activate",
];
const LOCK_NOTE: Record<string, string> = {
    liquid: "Withdraw any time",
    lock_1m: "Locked 1 month",
    lock_2m: "Locked 2 months",
    lock_3m: "Locked 3 months",
    manager: "Not in your total · no lock",
};

type DepositPool = PoolKey | "manager";
const NO_SPLIT: Record<DepositPool, string> = {
    liquid: "",
    lock_1m: "",
    lock_2m: "",
    lock_3m: "",
    manager: "",
};
// "Base Sepolia · USDC · …7f3a": chain, token, end of the token contract.
const assetLabel = (a: Asset) =>
    `${a.chainName} · ${a.symbol} · …${a.tokenAddress.slice(-4)}`;

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
    // The deposit just created; its card scrolls into view once it loads.
    const [created, setCreated] = useState("");

    if (assets.isLoading || vaults.isLoading || intents.isLoading)
        return <Skeleton />;
    const err = assets.error || vaults.error || intents.error;
    if (err) return <ErrorText error={err} />;

    // Past deposits live in History; only ones still in flight show here.
    const active = intents.data!.filter((i) => ACTIVE.includes(i.status));
    const ctx = { assets: assets.data!, vaults: vaults.data! };

    return (
        <div className="flex flex-col gap-3">
            <Header title="Deposit">
                <span className="opacity-90">
                    Earn up to 10% a year · minimum ${MIN_USD}
                </span>
            </Header>
            {active.map((i) => (
                <IntentCard
                    key={i.id}
                    intent={i}
                    focus={i.id === created}
                    {...ctx}
                />
            ))}
            {active.length > 0 && (
                <h2 className="display mt-2 text-xl font-bold">New deposit</h2>
            )}
            <NewDeposit {...ctx} onCreated={setCreated} />
        </div>
    );
}

function NewDeposit({
    assets,
    vaults,
    onCreated,
}: {
    assets: Asset[];
    vaults: Vault[];
    onCreated: (id: string) => void;
}) {
    const qc = useQueryClient();
    const key = useRef(newKey());
    const [assetId, setAssetId] = useState(assets[0]?.assetId ?? "");
    const [amount, setAmount] = useState("");
    const [mode, setMode] = useState<AllocMode>("usd");
    const [raw, setRaw] = useState(NO_SPLIT);
    const me = useQuery({
        queryKey: ["me"],
        queryFn: () => api<{ id: string; isAdmin?: boolean }>("/me"),
    });
    const pools: DepositPool[] = me.data?.isAdmin
        ? [...USER_POOLS, "manager"]
        : USER_POOLS;

    const asset = assets.find((a) => a.assetId === assetId);
    const vault =
        asset &&
        vaults
            .filter((v) => v.chainUuid === asset.chainUuid)
            .sort((a, b) => a.nonce - b.nonce)[0];
    const units = asset ? parseUnits(amount, asset.decimals) : null;
    // Stablecoins only, so the token amount is the dollar amount.
    const amt = Number(amount.replace(",", ".")) || 0;
    const bps = splitBps(
        pools.map((p) => raw[p]),
        mode,
        amt,
    );
    // An all-manager deposit (admin bootstrap) needs only $1.
    const minUsd = bps[pools.indexOf("manager")] === 10000 ? 1 : MIN_USD;
    const usdOk =
        asset &&
        units !== null &&
        units >= BigInt(minUsd) * 10n ** BigInt(asset.decimals);
    const total = bps.reduce((s, b) => s + b, 0);
    const left = 10000 - total;
    // What still blocks the button, shown as its label.
    const need = !asset
        ? "Choose a network"
        : !vault
          ? "No deposit address on this network yet"
          : !units
            ? "Enter amount to deposit"
            : !usdOk
              ? `Minimum deposit is $${minUsd}`
              : left > 0
                ? mode === "usd"
                    ? `Split $${fmtUsd(BigInt(Math.round(((amt * left) / 10000) * 1e6)))} more between tiers`
                    : `Split ${bpsPct(left)} more between tiers`
                : left < 0
                  ? "Tiers add up to more than the amount"
                  : null;

    const setTier = (p: DepositPool, b: number) =>
        setRaw({ ...raw, [p]: fromBps(Math.max(0, b), mode, amt) });
    const switchMode = (m: AllocMode) => {
        // Keep the split, show it in the other unit.
        const next = { ...raw };
        pools.forEach((p, i) => (next[p] = fromBps(bps[i], m, amt)));
        setRaw(next);
        setMode(m);
    };

    const create = useMutation({
        mutationFn: () =>
            api<Intent>("/me/deposits/intents", {
                method: "POST",
                idempotencyKey: key.current,
                body: {
                    vaultId: vault!.id,
                    assetId,
                    intendedAmount: units!.toString(),
                    allocations: pools
                        .map((p, i) => ({ pool: p, bps: bps[i] }))
                        .filter((x) => x.bps > 0),
                },
            }),
        onSuccess: (intent) => {
            key.current = newKey();
            setAmount("");
            setRaw(NO_SPLIT);
            onCreated(intent.id);
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

    const leftText =
        left === 0
            ? amt > 0
                ? `All $${fmtUsd(BigInt(Math.round(amt * 1e6)))} allocated`
                : "100% allocated"
            : left > 0
              ? `${bpsPct(left)} left to allocate`
              : `Over by ${bpsPct(-left)}`;

    return (
        <>
            <Card className="flex flex-col gap-3.5">
                <Field label="Network and token">
                    <Select
                        value={assetId}
                        onChange={(e) => setAssetId(e.target.value)}
                    >
                        {assets.map((a) => (
                            <option key={a.assetId} value={a.assetId}>
                                {assetLabel(a)}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field label={`Amount · minimum $${minUsd}`}>
                    <span className="flex h-14 items-center rounded-[14px] border-2 border-[var(--accent)] bg-[var(--field)] px-4">
                        <span className="display text-2xl text-[var(--hint)]">
                            $
                        </span>
                        <input
                            inputMode="decimal"
                            value={amount}
                            onChange={(e) => {
                                setAmount(e.target.value);
                                setRaw(NO_SPLIT);
                            }}
                            placeholder="100"
                            aria-label="Amount"
                            className="display min-w-0 flex-1 bg-transparent pl-1 text-2xl font-semibold outline-none"
                        />
                    </span>
                </Field>
            </Card>

            <Card className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2.5">
                    <h2 className="text-[15px] font-semibold">
                        Split between tiers
                    </h2>
                    <Segmented
                        label="Enter in"
                        className="w-[96px]"
                        options={[
                            { id: "usd", label: "$" },
                            { id: "pct", label: "%" },
                        ]}
                        value={mode}
                        onChange={switchMode}
                    />
                </div>
                <div
                    aria-hidden="true"
                    className="flex h-2 overflow-hidden rounded-full bg-[var(--track)]"
                >
                    {pools.map((p, i) => (
                        <div
                            key={p}
                            style={{
                                width: `${Math.min(100, bps[i] / 100)}%`,
                                background: TIER_COLOR[p],
                            }}
                        />
                    ))}
                </div>
                <div
                    className="text-[13px] font-semibold"
                    style={{
                        color:
                            left === 0
                                ? "var(--good)"
                                : left > 0
                                  ? "var(--warn)"
                                  : "var(--bad)",
                    }}
                >
                    {leftText}
                    {mode === "usd" && !amt && " · enter the amount first"}
                </div>

                {pools.map((p, i) => {
                    const others = total - bps[i];
                    const mgr = p === "manager";
                    return (
                        <div
                            key={p}
                            className={`flex flex-col gap-2.5 rounded-[14px] p-3 ${mgr ? "border-[1.5px] border-dashed border-[var(--mgr)]" : "border border-[var(--line)]"}`}
                            style={
                                bps[i] && !mgr
                                    ? {
                                          borderColor: `color-mix(in srgb, ${TIER_COLOR[p]} 45%, var(--line))`,
                                      }
                                    : undefined
                            }
                        >
                            <div className="flex items-center gap-2.5">
                                <span
                                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                                    style={{ background: TIER_COLOR[p] }}
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="block font-semibold">
                                        {mgr
                                            ? "Manager · admin only"
                                            : `${POOL_LABEL[p]} · ${bpsPct(POOL_APY_BPS[p])}`}
                                    </span>
                                    <span className="block text-xs text-[var(--hint)]">
                                        {LOCK_NOTE[p]}
                                    </span>
                                </span>
                                <span className="flex h-10 w-[118px] items-center rounded-[12px] border border-[var(--line)] bg-[var(--field)] px-3">
                                    {mode === "usd" && (
                                        <span className="text-[var(--hint)]">
                                            $
                                        </span>
                                    )}
                                    <input
                                        inputMode="decimal"
                                        value={raw[p]}
                                        onChange={(e) =>
                                            setRaw({
                                                ...raw,
                                                [p]: e.target.value,
                                            })
                                        }
                                        placeholder="0"
                                        aria-label={`${mgr ? "Manager" : POOL_LABEL[p]} ${mode === "usd" ? "amount in USD" : "percent"}`}
                                        className="min-w-0 flex-1 bg-transparent text-right text-[15px] font-semibold outline-none"
                                    />
                                    {mode === "pct" && (
                                        <span className="text-[var(--hint)]">
                                            %
                                        </span>
                                    )}
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                {(
                                    [
                                        ["25%", 2500],
                                        ["50%", 5000],
                                        ["75%", 7500],
                                        ["Rest", 10000 - others],
                                    ] as const
                                ).map(([label, b], j, all) => (
                                    <Chip
                                        key={label}
                                        // Light only the first chip that matches.
                                        on={
                                            bps[i] > 0 &&
                                            all.findIndex(
                                                (c) => c[1] === bps[i],
                                            ) === j
                                        }
                                        onClick={() => setTier(p, b)}
                                        className="px-2.5"
                                    >
                                        {label}
                                    </Chip>
                                ))}
                                <span className="ml-auto text-xs text-[var(--hint)]">
                                    {mode === "usd"
                                        ? bpsPct(bps[i])
                                        : amt
                                          ? `$${fmtUsd(BigInt(Math.round(((amt * bps[i]) / 10000) * 1e6)))}`
                                          : ""}
                                </span>
                            </div>
                        </div>
                    );
                })}
                <p className="text-xs text-[var(--hint)]">
                    Locked tiers pay more but charge a{" "}
                    <span className="font-semibold text-[var(--bad)]">
                        10% fee
                    </span>{" "}
                    if you withdraw early.
                </p>
            </Card>

            <ErrorText error={create.error} />
            <Button
                size="lg"
                className="w-full"
                disabled={!!need || create.isPending}
                onClick={() => create.mutate()}
            >
                {create.isPending
                    ? "Creating…"
                    : (need ?? "Get deposit address")}
            </Button>
        </>
    );
}

function IntentCard({
    intent: i,
    assets,
    vaults,
    focus,
}: {
    intent: Intent;
    assets: Asset[];
    vaults: Vault[];
    focus: boolean;
}) {
    const qc = useQueryClient();
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (focus)
            ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, [focus]);
    const [hash, setHash] = useState("");
    const [msg, setMsg] = useState("");
    const [copied, setCopied] = useState(false);
    const [showToken, setShowToken] = useState(false);
    const [enterHash, setEnterHash] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const t = setTimeout(() => setCopied(false), 2000);
        return () => clearTimeout(t);
    }, [copied]);
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
    // Tapping the token name shows its full contract address.
    const sym = asset ? (
        <button
            onClick={() => setShowToken(!showToken)}
            aria-expanded={showToken}
            className="cursor-pointer underline decoration-dotted underline-offset-2"
        >
            {asset.symbol}
        </button>
    ) : (
        ""
    );
    const intended = formatUnits(i.intendedAmount, dec, 2);

    return (
        <div ref={ref} className="scroll-mt-4">
            <Card className="flex flex-col gap-3.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                        {intended} {sym} deposit
                    </span>
                    <StatusBadge status={i.status} />
                </div>
                {showToken && asset && (
                    <p className="-mt-1.5 text-xs text-[var(--hint)]">
                        {asset.symbol} contract on {asset.chainName}:{" "}
                        <span className="font-mono break-all text-[var(--fg)]">
                            {asset.tokenAddress}
                        </span>
                    </p>
                )}

                {i.status === "intent" && vault && asset && (
                    <>
                        <p>
                            Send{" "}
                            <b>
                                {intended} {sym}
                            </b>{" "}
                            on <b>{asset.chainName}</b> to this address. Use
                            only this network and token.
                        </p>
                        <div className="rounded-xl bg-[var(--bg)] px-3.5 py-3 font-mono text-[13px] break-all">
                            {vault.address}
                        </div>
                        <Button
                            variant="ghost"
                            onClick={() =>
                                navigator.clipboard
                                    ?.writeText(vault.address)
                                    .then(() => setCopied(true))
                            }
                        >
                            {copied ? "Address copied ✓" : "Copy address"}
                        </Button>
                        <p className="text-xs text-[var(--hint)]">
                            Valid until {new Date(i.expiresAt).toLocaleString()}
                            .
                            {!vault.isDeployed &&
                                " Your vault is created when the deposit is processed; it is safe to send before that."}
                        </p>
                        <Button
                            disabled={check.isPending}
                            onClick={() => check.mutate()}
                        >
                            {check.isPending ? "Checking…" : "I sent it"}
                        </Button>
                        {/* Offered once the user has said they sent it, even if the check failed. */}
                        {(check.isSuccess || check.isError) && !enterHash && (
                            <>
                                <p className="text-sm text-[var(--hint)]">
                                    Not detected?
                                </p>
                                <Button
                                    variant="ghost"
                                    onClick={() => setEnterHash(true)}
                                >
                                    Enter the transaction hash
                                </Button>
                            </>
                        )}
                        {enterHash && (
                            <div className="flex gap-2">
                                <Input
                                    value={hash}
                                    onChange={(e) => setHash(e.target.value)}
                                    placeholder="0x…"
                                    aria-label="Transaction hash"
                                    className="!h-10 font-mono !text-xs"
                                />
                                <Button
                                    className="!h-10"
                                    disabled={
                                        !/^0x[a-fA-F0-9]{64}$/.test(
                                            hash.trim(),
                                        ) || attach.isPending
                                    }
                                    onClick={() => attach.mutate()}
                                >
                                    Send
                                </Button>
                            </div>
                        )}
                        <Button
                            variant="danger"
                            disabled={cancel.isPending}
                            onClick={() => cancel.mutate()}
                        >
                            {cancel.isPending
                                ? "Cancelling…"
                                : "Cancel deposit"}
                        </Button>
                    </>
                )}

                {i.status === "transfer_detected" && (
                    <p>We see your transfer. It will be confirmed shortly.</p>
                )}

                {i.status === "awaiting_user_approval" && (
                    <>
                        <p>
                            You planned{" "}
                            <b>
                                {intended} {sym}
                            </b>{" "}
                            but{" "}
                            <b>
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
                            className="h-[60px] text-[17px]"
                            disabled={approve.isPending}
                            onClick={() => approve.mutate()}
                        >
                            Approve received amount
                        </Button>
                    </>
                )}

                {i.status === "ready_to_activate" && (
                    <p>
                        Funds confirmed. Your deposit starts earning once it is
                        activated.
                    </p>
                )}

                {msg && <p className="text-sm text-[var(--hint)]">{msg}</p>}
                <ErrorText
                    error={
                        check.error ||
                        attach.error ||
                        approve.error ||
                        cancel.error
                    }
                />
            </Card>
        </div>
    );
}
