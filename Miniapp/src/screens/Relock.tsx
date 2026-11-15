import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, newKey } from "../lib/api";
import { bpsPct, fmtUsd, formatUnits, parseUnits } from "../lib/money";
import {
    POOL_APY_BPS,
    POOL_LABEL,
    type Lot,
    type PoolKey,
    type RelockRow,
} from "../lib/types";
import { usePortfolio, useRelocks } from "../lib/queries";
import { Button, Card, ErrorText, Hint, StatusBadge } from "../components/ui";

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
    const rl = useRelocks();
    if (pf.isLoading) return <Hint>Loading…</Hint>;
    if (pf.error) return <ErrorText error={pf.error} />;
    const lots = pf.data!.lots.filter((l) => avail(l) > 0n);

    return (
        <div className="space-y-4">
            <div>
                <h2 className="font-medium">Relock</h2>
                <Hint>
                    Move money to a longer tier for a higher rate. No fee.
                    Changes apply at the next settlement and restart the lock
                    period.
                </Hint>
            </div>
            {lots.length === 0 && <Hint>Nothing available to relock.</Hint>}
            {lots.map((l) => (
                <LotRelock key={l.lotId} lot={l} />
            ))}
            <RelockList rows={rl.data ?? []} />
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
    const micro = all ? avail(lot) : parseUnits(amount, 6);
    const valid =
        !!target && micro !== null && micro > 0n && micro <= avail(lot);

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
            for (const k of ["portfolio", "relocks"])
                qc.invalidateQueries({ queryKey: [k] });
        },
    });

    return (
        <Card className="space-y-2">
            <div className="flex justify-between">
                <span className="font-medium">{POOL_LABEL[lot.pool]}</span>
                <span className="tnum">${fmtUsd(avail(lot))}</span>
            </div>
            <div className="text-sm text-[var(--hint)]">
                {lot.maturesAt
                    ? `${active(lot) ? "Unlocks" : "Unlocked"} ${new Date(lot.maturesAt).toLocaleDateString()}`
                    : "No lock"}
            </div>
            {opts.length === 0 ? (
                <Hint>Already on the longest tier.</Hint>
            ) : !open ? (
                <Button
                    variant="ghost"
                    className="w-full"
                    onClick={() => setOpen(true)}
                >
                    Relock…
                </Button>
            ) : (
                <div className="space-y-2">
                    <select
                        value={target}
                        onChange={(e) => setTarget(e.target.value as Lock)}
                        className="w-full rounded-xl p-3 bg-[var(--bg)]"
                    >
                        {opts.map((t) => (
                            <option key={t} value={t}>
                                {POOL_LABEL[t]} · {bpsPct(POOL_APY_BPS[t])}
                            </option>
                        ))}
                    </select>
                    <div className="flex gap-2">
                        <input
                            inputMode="decimal"
                            value={all ? formatUnits(avail(lot), 6, 6) : amount}
                            onChange={(e) => {
                                setAll(false);
                                setAmount(e.target.value);
                            }}
                            placeholder="Amount in USD"
                            className="flex-1 min-w-0 rounded-xl p-3 bg-[var(--bg)] tnum"
                        />
                        <Button variant="ghost" onClick={() => setAll(true)}>
                            Max
                        </Button>
                    </div>
                    <ErrorText error={go.error} />
                    <div className="flex gap-2">
                        <Button
                            className="flex-1"
                            disabled={!valid || go.isPending}
                            onClick={() => go.mutate()}
                        >
                            {go.isPending ? "Queuing…" : "Queue relock"}
                        </Button>
                        <Button variant="ghost" onClick={() => setOpen(false)}>
                            Close
                        </Button>
                    </div>
                </div>
            )}
        </Card>
    );
}

function RelockList({ rows }: { rows: RelockRow[] }) {
    const qc = useQueryClient();
    const cancel = useMutation({
        mutationFn: (id: string) =>
            api(`/me/relocks/${id}/cancel`, { method: "POST" }),
        onSuccess: () => {
            for (const k of ["portfolio", "relocks"])
                qc.invalidateQueries({ queryKey: [k] });
        },
    });
    if (!rows.length) return null;
    return (
        <div>
            <h2 className="font-medium mb-2">Your relocks</h2>
            <div className="space-y-2">
                {rows.slice(0, 10).map((r) => (
                    <Card key={r.id} className="space-y-1">
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-[var(--hint)]">
                                {new Date(r.createdAt).toLocaleDateString()}
                            </span>
                            <StatusBadge status={r.status} />
                        </div>
                        {r.items.map((i) => (
                            <div
                                key={i.id}
                                className="text-sm flex justify-between"
                            >
                                <span>
                                    →{" "}
                                    {i.targetPool
                                        ? POOL_LABEL[i.targetPool]
                                        : ""}
                                </span>
                                <span className="tnum">
                                    {i.isMax
                                        ? "all"
                                        : i.amountUsd
                                          ? "$" + fmtUsd(i.amountUsd)
                                          : ""}
                                </span>
                            </div>
                        ))}
                        {r.items.some((i) => i.failureReason) && (
                            <div className="text-sm text-[var(--bad)]">
                                {
                                    r.items.find((i) => i.failureReason)!
                                        .failureReason
                                }
                            </div>
                        )}
                        {r.status === "pending" && (
                            <Button
                                variant="danger"
                                className="w-full !py-2"
                                disabled={cancel.isPending}
                                onClick={() => cancel.mutate(r.id)}
                            >
                                Cancel
                            </Button>
                        )}
                    </Card>
                ))}
            </div>
            <ErrorText error={cancel.error} />
        </div>
    );
}
