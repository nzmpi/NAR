import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, newKey } from "../lib/api";
import { bpsPct, fmtUsd, formatUnits, parseUnits } from "../lib/money";
import { POOL_APY_BPS, POOL_LABEL, type Lot, type PoolKey } from "../lib/types";
import { usePortfolio } from "../lib/queries";
import {
    Button,
    Card,
    Chip,
    ErrorText,
    Header,
    Hint,
    Skeleton,
    Input,
    TIER_COLOR,
    TIER_SHORT,
} from "../components/ui";

type Lock = "lock_1m" | "lock_2m" | "lock_3m";
const LOCKS: Lock[] = ["lock_1m", "lock_2m", "lock_3m"];
const RANK: Record<PoolKey, number> = {
    liquid: 0,
    lock_1m: 1,
    lock_2m: 2,
    lock_3m: 3,
};
const avail = (l: Lot) => BigInt(l.valueUsd) - BigInt(l.reservedUsd);
const active = (l: Lot) =>
    l.pool !== "liquid" && !!l.maturesAt && new Date(l.maturesAt) > new Date();
const targets = (l: Lot): Lock[] =>
    active(l) ? LOCKS.filter((t) => RANK[t] > RANK[l.pool]) : LOCKS;

export function Relock() {
    const pf = usePortfolio();
    if (pf.isLoading) return <Skeleton />;
    if (pf.error) return <ErrorText error={pf.error} />;
    const lots = pf.data!.lots.filter((l) => avail(l) > 0n);

    return (
        <div className="flex flex-col gap-3">
            <Header title="Relock">
                <span className="opacity-90">
                    Move money to a longer tier for a higher rate. No fee.
                    Applies at the next settlement and restarts the lock period.
                </span>
            </Header>
            {lots.length === 0 && <Hint>Nothing available to relock.</Hint>}
            {lots.map((l) => (
                <LotRelock key={l.lotId} lot={l} />
            ))}
        </div>
    );
}

function LotRelock({ lot }: { lot: Lot }) {
    const qc = useQueryClient();
    const key = useRef(newKey());
    const opts = targets(lot);
    const [open, setOpen] = useState(false);
    const [target, setTarget] = useState<Lock | "">(opts[0] ?? "");
    const [amount, setAmount] = useState("");
    const [all, setAll] = useState(false);
    const [part, setPart] = useState(""); // which quick chip is active
    const micro = all ? avail(lot) : parseUnits(amount, 6);
    const valid =
        !!target && micro !== null && micro > 0n && micro <= avail(lot);
    const color = TIER_COLOR[lot.pool];

    const go = useMutation({
        mutationFn: () =>
            api("/me/relocks", {
                method: "POST",
                idempotencyKey: key.current,
                body: {
                    items: [
                        {
                            lotId: lot.lotId,
                            targetPool: target,
                            ...(all
                                ? { max: true }
                                : { amountUsd: micro!.toString() }),
                        },
                    ],
                },
            }),
        onSuccess: () => {
            key.current = newKey();
            setOpen(false);
            setAmount("");
            setAll(false);
            setPart("");
            for (const k of ["portfolio", "relocks"])
                qc.invalidateQueries({ queryKey: [k] });
        },
    });

    // Share of this position, rounded down to whole cents.
    const pick = (label: string, quarters: number) => {
        setPart(label);
        if (quarters === 4) {
            setAll(true);
            return;
        }
        setAll(false);
        const v = (avail(lot) * BigInt(quarters)) / 4n;
        setAmount(formatUnits(v - (v % 10_000n), 6, 2).replaceAll(",", ""));
    };

    return (
        <Card className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
                <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-current/15 text-xs font-semibold"
                    style={{ color }}
                >
                    {TIER_SHORT[lot.pool]}
                </span>
                <span className="flex-1">
                    <span className="block font-semibold">
                        {POOL_LABEL[lot.pool]} ·{" "}
                        {bpsPct(POOL_APY_BPS[lot.pool])}
                    </span>
                    <span className="block text-xs text-[var(--hint)]">
                        {lot.maturesAt
                            ? `${active(lot) ? "Unlocks" : "Unlocked"} ${new Date(lot.maturesAt).toLocaleDateString()}`
                            : "No lock"}
                    </span>
                </span>
                <span className="display text-xl font-bold">
                    ${fmtUsd(avail(lot))}
                </span>
            </div>

            {opts.length === 0 ? (
                <Hint>Already on the longest tier.</Hint>
            ) : !open ? (
                <Button variant="ghost" onClick={() => setOpen(true)}>
                    Relock…
                </Button>
            ) : (
                <div className="flex flex-col gap-2.5 border-t border-[var(--row)] pt-3">
                    <span className="text-[13px] text-[var(--hint)]">
                        Move to
                    </span>
                    <div
                        role="radiogroup"
                        aria-label="Target tier"
                        className="grid grid-cols-3 gap-2"
                    >
                        {opts.map((t) => {
                            const on = t === target;
                            return (
                                <button
                                    key={t}
                                    role="radio"
                                    aria-checked={on}
                                    onClick={() => setTarget(t)}
                                    className={`cursor-pointer rounded-[14px] px-1.5 py-2.5 ${on ? "border-2" : "border border-[var(--line)] bg-[var(--card)]"}`}
                                    style={
                                        on
                                            ? {
                                                  borderColor: TIER_COLOR[t],
                                                  background: `color-mix(in srgb, ${TIER_COLOR[t]} 12%, transparent)`,
                                              }
                                            : undefined
                                    }
                                >
                                    <span className="block font-semibold">
                                        {POOL_LABEL[t]}
                                    </span>
                                    <span className="block text-xs opacity-80">
                                        {bpsPct(POOL_APY_BPS[t])}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    <Input
                        inputMode="decimal"
                        value={
                            all
                                ? formatUnits(avail(lot), 6, 2).replaceAll(
                                      ",",
                                      "",
                                  )
                                : amount
                        }
                        onChange={(e) => {
                            setAll(false);
                            setPart("");
                            setAmount(e.target.value);
                        }}
                        placeholder="Amount in USD"
                        aria-label="Amount in USD"
                        className="font-semibold"
                    />
                    <div className="grid grid-cols-4 gap-1.5">
                        {(
                            [
                                ["25%", 1],
                                ["50%", 2],
                                ["75%", 3],
                                ["Max", 4],
                            ] as const
                        ).map(([label, q]) => (
                            <Chip
                                key={label}
                                on={part === label}
                                onClick={() => pick(label, q)}
                                className="!h-9 text-[13px]"
                            >
                                {label}
                            </Chip>
                        ))}
                    </div>
                    <ErrorText error={go.error} />
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            className="flex-1"
                            disabled={!valid || go.isPending}
                            onClick={() => go.mutate()}
                        >
                            {go.isPending ? "Queuing…" : "Queue relock"}
                        </Button>
                    </div>
                </div>
            )}
            {go.isSuccess && !open && (
                <p className="text-sm text-[var(--good)]">
                    Queued. You can follow or cancel it in History.
                </p>
            )}
        </Card>
    );
}
