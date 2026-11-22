import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, newKey } from "../lib/api";
import { fmtUsd, formatUnits, parseUnits } from "../lib/money";
import { POOL_LABEL, type Lot, type WithdrawalQuote } from "../lib/types";
import { useAssets, usePayoutAddresses, usePortfolio } from "../lib/queries";
import {
    Button,
    Card,
    Chip,
    ErrorText,
    Field,
    Header,
    Hint,
    Input,
    Select,
    TIER_COLOR,
} from "../components/ui";

const MIN_MICRO = 5_000_000n;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const avail = (l: Lot) => BigInt(l.valueUsd) - BigInt(l.reservedUsd);
const isActiveLock = (l: Lot) =>
    l.pool !== "liquid" && !!l.maturesAt && new Date(l.maturesAt) > new Date();
const shortDate = (s: string) =>
    new Date(s).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
    });

export function Withdraw() {
    const qc = useQueryClient();
    const pf = usePortfolio();
    const assets = useAssets();
    const saved = usePayoutAddresses();
    const key = useRef(newKey());

    const [assetId, setAssetId] = useState("");
    const [dest, setDest] = useState("");
    const [amount, setAmount] = useState("");
    // Locked picks are automatic until the user edits one.
    const [manual, setManual] = useState(false);
    const [sel, setSel] = useState<Record<string, string>>({}); // lotId -> usd text
    const [max, setMax] = useState<Record<string, boolean>>({});
    const [quote, setQuote] = useState<WithdrawalQuote | null>(null);
    const [done, setDone] = useState("");

    if (pf.isLoading || assets.isLoading) return <Hint>Loading…</Hint>;
    if (pf.error || assets.error)
        return <ErrorText error={pf.error || assets.error} />;

    const lots = pf.data!.lots;
    const manager = BigInt(pf.data!.managerAvailableUsd);
    const liquidOnly = lots
        .filter((l) => l.pool === "liquid")
        .reduce((s, l) => s + avail(l), 0n);
    // Fee-free now: liquid plus manager funds (admins only).
    const liquid = liquidOnly + manager;
    const lockLots = lots
        .filter((l) => l.pool !== "liquid" && avail(l) > 0n)
        .sort(
            (a, b) =>
                Number(isActiveLock(a)) - Number(isActiveLock(b)) ||
                (a.maturesAt ?? "").localeCompare(b.maturesAt ?? ""),
        );
    const lockedTotal = lockLots.reduce((s, l) => s + avail(l), 0n);
    const assetList = assets.data!;
    const asset = assetList.find(
        (a) => a.assetId === (assetId || assetList[0]?.assetId),
    );

    const amountMicro = parseUnits(amount, 6);
    const remainder =
        amountMicro !== null && amountMicro > liquid
            ? amountMicro - liquid
            : 0n;

    // Soonest-unlocking positions first, each taken in full before the next.
    const auto: Record<string, bigint> = {};
    let left = remainder;
    for (const l of lockLots) {
        if (left <= 0n) break;
        auto[l.lotId] = left < avail(l) ? left : avail(l);
        left -= auto[l.lotId];
    }
    const isMax = (l: Lot) =>
        manual ? !!max[l.lotId] : auto[l.lotId] === avail(l);
    const selMicro = (l: Lot) =>
        manual
            ? max[l.lotId]
                ? avail(l)
                : (parseUnits(sel[l.lotId] ?? "", 6) ?? 0n)
            : (auto[l.lotId] ?? 0n);
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
        amountMicro <= liquid + lockedTotal;

    const edit = (fn: () => void) => {
        fn();
        setQuote(null);
        setDone("");
    };
    // First manual edit starts from the automatic picks.
    const editLot = (l: Lot, text: string | null) =>
        edit(() => {
            const s: Record<string, string> = manual ? { ...sel } : {};
            const m: Record<string, boolean> = manual ? { ...max } : {};
            if (!manual)
                for (const x of lockLots) {
                    if (auto[x.lotId] === avail(x)) m[x.lotId] = true;
                    else if (auto[x.lotId])
                        s[x.lotId] = formatUnits(auto[x.lotId], 6, 6);
                }
            if (text === null) m[l.lotId] = true;
            else {
                m[l.lotId] = false;
                s[l.lotId] = text;
            }
            setSel(s);
            setMax(m);
            setManual(true);
        });

    const body = () => ({
        assetId: asset!.assetId,
        destinationAddress: dest.trim(),
        amountUsd: amountMicro!.toString(),
        lockSelections: lockLots
            .filter((l) => selMicro(l) > 0n && remainder > 0n)
            .map((l) =>
                isMax(l)
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
            setManual(false);
            setDone(
                "Request submitted. You will get a message here when it is paid. You can follow or cancel it in History.",
            );
            for (const k of ["portfolio", "withdrawals"])
                qc.invalidateQueries({ queryKey: [k] });
        },
    });

    return (
        <div className="flex flex-col gap-3">
            <Header title="Withdraw">
                <span className="text-[13px] opacity-85">
                    Available now, no fee
                </span>
                <span className="display text-4xl leading-none font-bold">
                    ${fmtUsd(liquid)}
                </span>
                {manager > 0n && (
                    <span className="flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold">
                            Liquid ${fmtUsd(liquidOnly)}
                        </span>
                        <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold">
                            Manager ${fmtUsd(manager)} · admin
                        </span>
                    </span>
                )}
                {lockedTotal > 0n && (
                    <span className="opacity-90">
                        + ${fmtUsd(lockedTotal)} in locked positions
                    </span>
                )}
            </Header>

            <Card className="flex flex-col gap-3.5">
                <Field label="Receive on">
                    <Select
                        value={asset?.assetId ?? ""}
                        onChange={(e) => edit(() => setAssetId(e.target.value))}
                    >
                        {assetList.map((a) => (
                            <option key={a.assetId} value={a.assetId}>
                                {a.chainName} · {a.symbol} · …
                                {a.tokenAddress.slice(-4)}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field label="Your wallet address on that network">
                    <Input
                        value={dest}
                        onChange={(e) => edit(() => setDest(e.target.value))}
                        placeholder="0x…"
                        className="font-mono !text-[13px]"
                    />
                </Field>
                {(saved.data?.length ?? 0) > 0 && (
                    <div className="-mt-1.5 flex flex-wrap gap-1.5">
                        {saved.data!.slice(0, 3).map((a) => (
                            <Chip
                                key={a.address}
                                onClick={() => edit(() => setDest(a.address))}
                                className="font-mono"
                            >
                                {a.address.slice(0, 6)}…{a.address.slice(-4)}
                            </Chip>
                        ))}
                    </div>
                )}
                {dest && !addrOk && (
                    <p className="text-sm text-[var(--bad)]">
                        Not a valid address.
                    </p>
                )}
                <Field label="Amount in USD · minimum $5">
                    <span className="flex h-14 items-center rounded-[14px] border-2 border-[var(--accent)] bg-[var(--field)] px-4">
                        <span className="display text-2xl text-[var(--hint)]">
                            $
                        </span>
                        <input
                            inputMode="decimal"
                            value={amount}
                            onChange={(e) =>
                                edit(() => {
                                    setAmount(e.target.value);
                                    setManual(false);
                                })
                            }
                            placeholder="100"
                            aria-label="Amount in USD"
                            className="display min-w-0 flex-1 bg-transparent pl-1 text-2xl font-semibold outline-none"
                        />
                        <Chip
                            onClick={() =>
                                edit(() => {
                                    setAmount(
                                        formatUnits(
                                            liquid + lockedTotal,
                                            6,
                                            2,
                                        ).replaceAll(",", ""),
                                    );
                                    setManual(false);
                                })
                            }
                        >
                            Max
                        </Chip>
                    </span>
                </Field>
            </Card>

            {remainder > 0n && (
                <Card className="flex flex-col gap-3">
                    <p className="rounded-xl bg-[var(--warn-soft)] px-3 py-2.5 font-medium text-[var(--warn)]">
                        ${fmtUsd(remainder)} must come from locked positions.
                        Early withdrawal from an active lock costs 10%.
                    </p>
                    {lockLots.map((l) => (
                        <div
                            key={l.lotId}
                            className="flex items-center gap-3 rounded-[14px] border border-[var(--line)] p-3"
                        >
                            <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ background: TIER_COLOR[l.pool] }}
                            />
                            <span className="min-w-0 flex-1">
                                <span className="block font-semibold">
                                    {POOL_LABEL[l.pool]} ·{" "}
                                    {isActiveLock(l) ? "locked" : "unlocked"}
                                </span>
                                <span className="block text-xs text-[var(--hint)]">
                                    up to ${fmtUsd(avail(l))}
                                    {l.maturesAt &&
                                        isActiveLock(l) &&
                                        ` · unlocks ${shortDate(l.maturesAt)}`}
                                </span>
                            </span>
                            <input
                                inputMode="decimal"
                                value={
                                    isMax(l)
                                        ? formatUnits(
                                              avail(l),
                                              6,
                                              2,
                                          ).replaceAll(",", "")
                                        : manual
                                          ? (sel[l.lotId] ?? "")
                                          : auto[l.lotId]
                                            ? formatUnits(
                                                  auto[l.lotId],
                                                  6,
                                                  2,
                                              ).replaceAll(",", "")
                                            : ""
                                }
                                onChange={(e) => editLot(l, e.target.value)}
                                placeholder="0"
                                aria-label={`Amount from ${POOL_LABEL[l.pool]}`}
                                className="h-9 w-20 rounded-[10px] border border-[var(--line)] bg-[var(--field)] px-2 text-right font-semibold"
                            />
                            <Chip
                                on={isMax(l)}
                                onClick={() => editLot(l, null)}
                            >
                                Max
                            </Chip>
                        </div>
                    ))}
                    <div
                        className="text-[13px] font-semibold"
                        style={{
                            color:
                                lockSum === remainder
                                    ? "var(--good)"
                                    : "var(--warn)",
                        }}
                    >
                        {manual
                            ? `Selected $${fmtUsd(lockSum)} of $${fmtUsd(remainder)}`
                            : "Picked automatically, soonest unlock first."}
                    </div>
                </Card>
            )}

            <ErrorText error={preview.error || submit.error} />
            {!quote && (
                <Button
                    size="lg"
                    className="w-full"
                    disabled={!valid || preview.isPending}
                    onClick={() => preview.mutate()}
                >
                    {preview.isPending ? "Calculating…" : "Review withdrawal →"}
                </Button>
            )}

            {quote && asset && (
                <>
                    <Card className="flex flex-col gap-2">
                        <h2 className="mb-1 text-[15px] font-semibold">
                            Review
                        </h2>
                        <Row k="Amount" v={`$${fmtUsd(quote.grossUsd)}`} />
                        <Row
                            k="Early withdrawal fee (10%)"
                            v={
                                BigInt(quote.feeUsd) > 0n
                                    ? `−$${fmtUsd(quote.feeUsd)}`
                                    : "$0.00"
                            }
                            bad={BigInt(quote.feeUsd) > 0n}
                        />
                        <div className="flex justify-between border-t border-[var(--row)] pt-2 font-semibold">
                            <span>You receive</span>
                            <span className="display text-lg">
                                {formatUnits(
                                    quote.payoutAmount,
                                    asset.decimals,
                                    2,
                                )}{" "}
                                {asset.symbol}
                            </span>
                        </div>
                        <p className="text-xs text-[var(--hint)]">
                            Final amounts use the pool price when the payment is
                            made and can differ slightly. The fee is fixed at
                            the time you confirm.
                        </p>
                    </Card>
                    <Button
                        size="lg"
                        className="w-full"
                        disabled={submit.isPending}
                        onClick={() => submit.mutate()}
                    >
                        {submit.isPending
                            ? "Submitting…"
                            : "Confirm withdrawal →"}
                    </Button>
                    <Button variant="ghost" onClick={() => setQuote(null)}>
                        Back
                    </Button>
                </>
            )}
            {done && <p className="text-sm text-[var(--good)]">{done}</p>}
        </div>
    );
}

const Row = ({ k, v, bad }: { k: string; v: string; bad?: boolean }) => (
    <div className="flex justify-between">
        <span className="text-[var(--hint)]">{k}</span>
        <span className={bad ? "font-semibold text-[var(--bad)]" : undefined}>
            {v}
        </span>
    </div>
);
