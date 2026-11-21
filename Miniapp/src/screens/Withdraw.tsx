import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, newKey } from "../lib/api";
import { fmtUsd, formatUnits, parseUnits } from "../lib/money";
import {
    POOL_LABEL,
    type Lot,
    type WithdrawalQuote,
    type WithdrawalRow,
} from "../lib/types";
import {
    useAssets,
    usePayoutAddresses,
    usePortfolio,
    useWithdrawals,
} from "../lib/queries";
import { Button, Card, ErrorText, Hint, StatusBadge } from "../components/ui";

const MIN_MICRO = 5_000_000n;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const avail = (l: Lot) => BigInt(l.valueUsd) - BigInt(l.reservedUsd);
const isActiveLock = (l: Lot) =>
    l.pool !== "liquid" && !!l.maturesAt && new Date(l.maturesAt) > new Date();

export function Withdraw() {
    const qc = useQueryClient();
    const pf = usePortfolio();
    const assets = useAssets();
    const saved = usePayoutAddresses();
    const history = useWithdrawals();
    const key = useRef(newKey());

    const [assetId, setAssetId] = useState("");
    const [dest, setDest] = useState("");
    const [amount, setAmount] = useState("");
    const [sel, setSel] = useState<Record<string, string>>({}); // lotId -> usd text
    const [max, setMax] = useState<Record<string, boolean>>({});
    const [quote, setQuote] = useState<WithdrawalQuote | null>(null);
    const [done, setDone] = useState("");

    if (pf.isLoading || assets.isLoading) return <Hint>Loading…</Hint>;
    if (pf.error || assets.error)
        return <ErrorText error={pf.error || assets.error} />;

    const lots = pf.data!.lots;
    const manager = BigInt(pf.data!.managerAvailableUsd);
    // Fee-free now: liquid plus manager funds (admins only).
    const liquid =
        lots
            .filter((l) => l.pool === "liquid")
            .reduce((s, l) => s + avail(l), 0n) + manager;
    const lockLots = lots
        .filter((l) => l.pool !== "liquid" && avail(l) > 0n)
        .sort(
            (a, b) =>
                Number(isActiveLock(a)) - Number(isActiveLock(b)) ||
                (a.maturesAt ?? "").localeCompare(b.maturesAt ?? ""),
        );
    const assetList = assets.data!;
    const asset = assetList.find(
        (a) => a.assetId === (assetId || assetList[0]?.assetId),
    );

    const amountMicro = parseUnits(amount, 6);
    const remainder =
        amountMicro !== null && amountMicro > liquid
            ? amountMicro - liquid
            : 0n;
    const selMicro = (l: Lot) =>
        max[l.lotId] ? avail(l) : (parseUnits(sel[l.lotId] ?? "", 6) ?? 0n);
    const lockSum = lockLots.reduce((s, l) => s + selMicro(l), 0n);
    const exceeds = lockLots.some((l) => selMicro(l) > avail(l));
    const addrOk = ADDRESS.test(dest.trim());
    const valid =
        !!asset &&
        addrOk &&
        amountMicro !== null &&
        amountMicro >= MIN_MICRO &&
        !exceeds &&
        lockSum === remainder &&
        amountMicro <= liquid + lockLots.reduce((s, l) => s + avail(l), 0n);

    const edit = (fn: () => void) => {
        fn();
        setQuote(null);
        setDone("");
    };

    const autoFill = () =>
        edit(() => {
            let left = remainder;
            const s: Record<string, string> = {},
                m: Record<string, boolean> = {};
            for (const l of lockLots) {
                if (left <= 0n) break;
                const take = left < avail(l) ? left : avail(l);
                if (take === avail(l)) m[l.lotId] = true;
                else s[l.lotId] = formatUnits(take, 6, 6);
                left -= take;
            }
            setSel(s);
            setMax(m);
        });

    const body = () => ({
        assetId: asset!.assetId,
        destinationAddress: dest.trim(),
        amountUsd: amountMicro!.toString(),
        lockSelections: lockLots
            .filter((l) => selMicro(l) > 0n && remainder > 0n)
            .map((l) =>
                max[l.lotId]
                    ? { lotId: l.lotId, max: true }
                    : { lotId: l.lotId, grossUsd: selMicro(l).toString() },
            ),
    });

    const preview = useMutation({
        mutationFn: () =>
            api<WithdrawalQuote>("/me/withdrawals/preview", {
                method: "POST",
                body: body(),
            }),
        onSuccess: setQuote,
    });
    const submit = useMutation({
        mutationFn: () =>
            api<{ withdrawalId: string }>("/me/withdrawals", {
                method: "POST",
                body: body(),
                idempotencyKey: key.current,
            }),
        onSuccess: () => {
            key.current = newKey();
            setQuote(null);
            setAmount("");
            setSel({});
            setMax({});
            setDone(
                "Request submitted. You will get a message here when it is paid.",
            );
            for (const k of ["portfolio", "withdrawals"])
                qc.invalidateQueries({ queryKey: [k] });
        },
    });

    return (
        <div className="space-y-4">
            <Card className="space-y-3">
                <h2 className="font-medium">Withdraw</h2>
                <Hint>
                    Available now: ${fmtUsd(liquid)}{" "}
                    {manager > 0n ? "liquid and manager" : "liquid"}
                    {lockLots.length > 0 && " + locked positions"}.
                </Hint>

                <label className="block">
                    <Hint>Receive on</Hint>
                    <select
                        value={asset?.assetId ?? ""}
                        onChange={(e) => edit(() => setAssetId(e.target.value))}
                        className="w-full mt-1 rounded-xl p-3 bg-[var(--bg)]"
                    >
                        {assetList.map((a) => (
                            <option key={a.assetId} value={a.assetId}>
                                {a.chainName} · {a.symbol}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="block">
                    <Hint>Your wallet address on that network</Hint>
                    <input
                        value={dest}
                        onChange={(e) => edit(() => setDest(e.target.value))}
                        placeholder="0x…"
                        className="w-full mt-1 rounded-xl p-3 bg-[var(--bg)] font-mono text-xs"
                    />
                </label>
                {(saved.data?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {saved.data!.slice(0, 3).map((a) => (
                            <button
                                key={a.address}
                                onClick={() => edit(() => setDest(a.address))}
                                className="text-xs rounded-full border border-[var(--hint)]/40 px-2 py-1 font-mono"
                            >
                                {a.address.slice(0, 6)}…{a.address.slice(-4)}
                            </button>
                        ))}
                    </div>
                )}
                {dest && !addrOk && (
                    <p className="text-sm text-[var(--bad)]">
                        Not a valid address.
                    </p>
                )}

                <label className="block">
                    <Hint>Amount in USD (minimum $5)</Hint>
                    <input
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => edit(() => setAmount(e.target.value))}
                        placeholder="100"
                        className="w-full mt-1 rounded-xl p-3 bg-[var(--bg)] tnum"
                    />
                </label>

                {remainder > 0n && (
                    <div className="space-y-2">
                        <p className="text-sm text-[var(--warn)]">
                            ${fmtUsd(remainder)} must come from locked
                            positions. Early withdrawals from an active lock
                            cost 10%.
                        </p>
                        <Button variant="ghost" onClick={autoFill}>
                            Choose positions automatically
                        </Button>
                        {lockLots.map((l) => (
                            <div
                                key={l.lotId}
                                className="rounded-xl bg-[var(--bg)] p-3 space-y-1"
                            >
                                <div className="flex justify-between text-sm">
                                    <span>
                                        {POOL_LABEL[l.pool]} ·{" "}
                                        {isActiveLock(l)
                                            ? "locked"
                                            : "unlocked"}
                                    </span>
                                    <span className="tnum text-[var(--hint)]">
                                        up to ${fmtUsd(avail(l))}
                                    </span>
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        inputMode="decimal"
                                        value={
                                            max[l.lotId]
                                                ? formatUnits(avail(l), 6, 6)
                                                : (sel[l.lotId] ?? "")
                                        }
                                        onChange={(e) =>
                                            edit(() => {
                                                setMax({
                                                    ...max,
                                                    [l.lotId]: false,
                                                });
                                                setSel({
                                                    ...sel,
                                                    [l.lotId]: e.target.value,
                                                });
                                            })
                                        }
                                        placeholder="0"
                                        className="flex-1 min-w-0 rounded-lg p-2 bg-[var(--bg2)] tnum"
                                    />
                                    <Button
                                        variant="ghost"
                                        className="!py-2"
                                        onClick={() =>
                                            edit(() =>
                                                setMax({
                                                    ...max,
                                                    [l.lotId]: true,
                                                }),
                                            )
                                        }
                                    >
                                        Max
                                    </Button>
                                </div>
                            </div>
                        ))}
                        <div
                            className="text-sm tnum"
                            style={{
                                color:
                                    lockSum === remainder
                                        ? "var(--good)"
                                        : "var(--warn)",
                            }}
                        >
                            Selected ${fmtUsd(lockSum)} of ${fmtUsd(remainder)}
                        </div>
                    </div>
                )}

                <ErrorText error={preview.error || submit.error} />
                {!quote && (
                    <Button
                        className="w-full"
                        disabled={!valid || preview.isPending}
                        onClick={() => preview.mutate()}
                    >
                        {preview.isPending
                            ? "Calculating…"
                            : "Review withdrawal"}
                    </Button>
                )}
            </Card>

            {quote && asset && (
                <Card className="space-y-2">
                    <h3 className="font-medium">Review</h3>
                    <Row k="Amount" v={`$${fmtUsd(quote.grossUsd)}`} />
                    <Row
                        k="Early withdrawal fee (10%)"
                        v={`-$${fmtUsd(quote.feeUsd)}`}
                        bad={BigInt(quote.feeUsd) > 0n}
                    />
                    <Row
                        k="You receive"
                        v={`${formatUnits(quote.payoutAmount, asset.decimals, 2)} ${asset.symbol}`}
                        bold
                    />
                    <p className="text-xs text-[var(--hint)]">
                        Final amounts use the pool price when the payment is
                        made and can differ slightly. The fee is fixed at the
                        time you confirm.
                    </p>
                    <Button
                        className="w-full"
                        disabled={submit.isPending}
                        onClick={() => submit.mutate()}
                    >
                        {submit.isPending
                            ? "Submitting…"
                            : "Confirm withdrawal"}
                    </Button>
                    <Button
                        variant="ghost"
                        className="w-full"
                        onClick={() => setQuote(null)}
                    >
                        Back
                    </Button>
                </Card>
            )}
            {done && <p className="text-sm text-[var(--good)]">{done}</p>}

            <WithdrawalList rows={history.data ?? []} assets={assetList} />
        </div>
    );
}

const Row = ({
    k,
    v,
    bold,
    bad,
}: {
    k: string;
    v: string;
    bold?: boolean;
    bad?: boolean;
}) => (
    <div
        className={`flex justify-between text-sm ${bold ? "font-semibold" : ""}`}
    >
        <span className="text-[var(--hint)]">{k}</span>
        <span
            className="tnum"
            style={bad ? { color: "var(--bad)" } : undefined}
        >
            {v}
        </span>
    </div>
);

function WithdrawalList({
    rows,
    assets,
}: {
    rows: WithdrawalRow[];
    assets: { assetId: string; symbol: string; decimals: number }[];
}) {
    const qc = useQueryClient();
    const cancel = useMutation({
        mutationFn: (id: string) =>
            api(`/me/withdrawals/${id}/cancel`, { method: "POST" }),
        onSuccess: () => {
            for (const k of ["portfolio", "withdrawals"])
                qc.invalidateQueries({ queryKey: [k] });
        },
    });
    if (!rows.length) return null;
    return (
        <div>
            <h2 className="font-medium mb-2">Your withdrawals</h2>
            <div className="space-y-2">
                {rows.slice(0, 10).map((w) => {
                    const a = assets.find((x) => x.assetId === w.assetId);
                    return (
                        <Card key={w.id} className="space-y-1">
                            <div className="flex justify-between items-center">
                                <span className="tnum">
                                    ${fmtUsd(w.grossAmountUsd)}
                                </span>
                                <StatusBadge status={w.status} />
                            </div>
                            <div className="text-xs text-[var(--hint)]">
                                {new Date(w.createdAt).toLocaleString()} · net{" "}
                                {a
                                    ? formatUnits(
                                          w.payoutAmount,
                                          a.decimals,
                                          2,
                                      ) +
                                      " " +
                                      a.symbol
                                    : "$" + fmtUsd(w.netPayoutUsd)}
                            </div>
                            {w.status === "rejected" && w.rejectionReason && (
                                <div className="text-sm text-[var(--bad)]">
                                    {w.rejectionReason}
                                </div>
                            )}
                            {w.status === "pending" && w.lockedAt && (
                                <div className="text-xs text-[var(--hint)]">
                                    Payout in progress. It can no longer be
                                    cancelled.
                                </div>
                            )}
                            {w.status === "pending" && !w.lockedAt && (
                                <Button
                                    variant="danger"
                                    className="w-full !py-2"
                                    disabled={cancel.isPending}
                                    onClick={() => cancel.mutate(w.id)}
                                >
                                    Cancel request
                                </Button>
                            )}
                        </Card>
                    );
                })}
            </div>
            <ErrorText error={cancel.error} />
        </div>
    );
}
