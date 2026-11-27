import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, useAction } from "../lib/api";
import { fmtUsd, formatUnits, parseUnits } from "../lib/money";
import type { AdminPools, AdminWithdrawal } from "../lib/types";
import {
    Badge,
    Button,
    Card,
    ErrorText,
    Hint,
    Input,
    PAGE,
    Segmented,
    ShowMore,
    Onchain,
} from "../components/ui";

const FILTERS = ["pending", "paid", "rejected", "cancelled", "all"] as const;

export function Withdrawals() {
    const [filter, setFilter] = useState<(typeof FILTERS)[number]>("pending");
    const [limit, setLimit] = useState(PAGE);
    const q = useQuery({
        queryKey: ["admin-withdrawals", filter, limit],
        queryFn: () =>
            api<AdminWithdrawal[]>(
                `/admin/withdrawals?limit=${limit}${filter === "all" ? "" : `&status=${filter}`}`,
            ),
        refetchInterval: 30_000,
    });
    const pools = useQuery({
        queryKey: ["admin-pools"],
        queryFn: () => api<AdminPools>("/admin/pools"),
    });

    return (
        <div className="space-y-4">
            <Segmented
                label="Withdrawal status"
                value={filter}
                onChange={setFilter}
                options={FILTERS.map((f) => ({
                    id: f,
                    label: f[0].toUpperCase() + f.slice(1),
                }))}
            />
            {q.isLoading && <Hint>Loading…</Hint>}
            <ErrorText error={q.error} />
            {q.data?.length === 0 && <Hint>Nothing here.</Hint>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] items-start gap-3">
                {q.data?.map((r) => (
                    <Row
                        key={r.withdrawal.id}
                        r={r}
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

function Row({ r, nav }: { r: AdminWithdrawal; nav?: string }) {
    const qc = useQueryClient();
    const w = r.withdrawal;
    const [mode, setMode] = useState<"" | "lock" | "pay" | "reject">("");
    const [hash, setHash] = useState("");
    const [total, setTotal] = useState("");
    const [checked, setChecked] = useState(false);
    const [reason, setReason] = useState("");

    const done = () => {
        setMode("");
        for (const k of ["admin-withdrawals", "admin-pools"])
            qc.invalidateQueries({ queryKey: [k] });
    };
    const total6 = parseUnits(total, 6);
    const prev = nav ? BigInt(nav) : 0n;
    const move = total6 === null ? 0n : total6 - prev;
    // Same 10% rule as the server's settlement check.
    const big =
        prev > 0n && (move < 0n ? -move : move) * 10_000n > prev * 1_000n;
    const pay = useAction({
        mutationFn: (_, key) =>
            api("/admin/withdrawals/" + w.id + "/paid", {
                method: "POST",
                key,
                body: { txHash: hash.trim() },
            }),
        onSuccess: done,
    });
    const lock = useAction({
        mutationFn: (_, key) =>
            api("/admin/withdrawals/" + w.id + "/lock", {
                method: "POST",
                key,
                body: {
                    reportedTotalUsd: total6!.toString(),
                    confirmLargeMove: checked || undefined,
                },
            }),
        onSuccess: done,
    });
    const reject = useAction({
        mutationFn: (_, key) =>
            api("/admin/withdrawals/" + w.id + "/reject", {
                method: "POST",
                key,
                body: { reason: reason.trim() },
            }),
        onSuccess: done,
    });

    const who = r.username ? `@${r.username}` : r.telegramId;
    const payout =
        r.decimals !== undefined
            ? `${formatUnits(w.payoutAmount, r.decimals, 2)} ${r.symbol}`
            : `${r.symbol} (see net USD)`;

    return (
        <Card className="space-y-3 !p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="font-semibold">{who}</div>
                    <div className="text-xs text-[var(--hint)]">
                        {new Date(w.createdAt).toLocaleString()}
                    </div>
                </div>
                <Badge status={w.status} />
            </div>
            <dl className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-3 gap-y-2 text-sm tnum">
                <div>
                    <dt className="text-xs text-[var(--hint)]">Gross</dt>
                    <dd>${fmtUsd(w.grossAmountUsd)}</dd>
                </div>
                <div>
                    <dt className="text-xs text-[var(--hint)]">Early fee</dt>
                    <dd>${fmtUsd(w.earlyFeeUsd)}</dd>
                </div>
                <div>
                    <dt className="text-xs text-[var(--hint)]">
                        {w.lockedAt ? "Net (fixed)" : "Net (quoted)"}
                    </dt>
                    <dd className="font-semibold">${fmtUsd(w.netPayoutUsd)}</dd>
                </div>
                <div>
                    <dt className="text-xs text-[var(--hint)]">Send</dt>
                    <dd>{payout}</dd>
                </div>
            </dl>
            <div className="text-sm">
                <div className="text-xs text-[var(--hint)]">
                    To (chain {r.chainId})
                </div>
                <Onchain value={w.destinationAddress} chainId={r.chainId} />
            </div>
            {w.txHash && (
                <div className="text-sm">
                    <span className="text-[var(--hint)]">Tx: </span>
                    <Onchain value={w.txHash} chainId={r.chainId} />
                </div>
            )}
            {w.rejectionReason && (
                <div className="text-sm text-[var(--bad)]">
                    {w.rejectionReason}
                </div>
            )}

            {w.status === "pending" && w.awaitingUserAt && (
                <Hint>
                    Prices fell more than 1% since the request, so the amounts
                    above are lower than quoted. Waiting for the user to accept
                    or cancel; Mark paid stays blocked until then.
                </Hint>
            )}
            {w.status === "pending" && w.lockedAt && !w.awaitingUserAt && (
                <Hint>
                    Locked: the amounts are fixed and the user can no longer
                    cancel. Send exactly the amount above, then mark it paid.
                </Hint>
            )}
            {w.status === "pending" && mode === "" && (
                <div className="flex flex-wrap gap-2">
                    {!w.lockedAt ? (
                        <Button
                            onClick={() => {
                                // Prefill from the total now, not from when the card first rendered (#69).
                                setTotal(
                                    nav
                                        ? formatUnits(nav, 6, 2).replaceAll(
                                              ",",
                                              "",
                                          )
                                        : "",
                                );
                                setChecked(false);
                                setMode("lock");
                            }}
                        >
                            Lock for payout…
                        </Button>
                    ) : (
                        !w.awaitingUserAt && (
                            <Button onClick={() => setMode("pay")}>
                                Mark paid…
                            </Button>
                        )
                    )}
                    <Button variant="danger" onClick={() => setMode("reject")}>
                        Reject…
                    </Button>
                </div>
            )}
            {mode === "lock" && (
                <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
                    <Hint>
                        Locking settles the fund at this total, then fixes the
                        amount to send. If prices fell more than 1% since the
                        request, the user must accept the lower amount first.
                    </Hint>
                    <label className="block text-sm">
                        Total managed funds now (USD), counting this payout as
                        still managed
                        <Input
                            inputMode="decimal"
                            value={total}
                            onChange={(e) => {
                                setTotal(e.target.value);
                                setChecked(false);
                            }}
                            className="tnum mt-1"
                        />
                    </label>
                    {big && (
                        <label className="flex items-center gap-2.5 rounded-xl bg-[var(--warn-soft)] px-3.5 py-3 text-sm font-medium text-[var(--warn)]">
                            <input
                                type="checkbox"
                                className="h-[18px] w-[18px]"
                                checked={checked}
                                onChange={(e) => setChecked(e.target.checked)}
                            />
                            Change is over 10%. I have double-checked the
                            number.
                        </label>
                    )}
                    <ErrorText error={lock.error} />
                    <div className="flex gap-2">
                        <Button
                            disabled={
                                total6 === null ||
                                total6 <= 0n ||
                                (big && !checked) ||
                                lock.isPending
                            }
                            onClick={() => lock.mutate()}
                        >
                            {lock.isPending ? "Locking…" : "Lock"}
                        </Button>
                        <Button variant="ghost" onClick={() => setMode("")}>
                            Cancel
                        </Button>
                    </div>
                </div>
            )}
            {mode === "pay" && (
                <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
                    <Hint>
                        Send exactly {payout} first, then enter the transaction
                        hash. The amounts were fixed at lock and do not change.
                    </Hint>
                    <Input
                        placeholder="Payment tx hash 0x…"
                        value={hash}
                        onChange={(e) => setHash(e.target.value)}
                        className="font-mono"
                    />
                    <ErrorText error={pay.error} />
                    <div className="flex gap-2">
                        <Button
                            disabled={
                                !/^0x[a-fA-F0-9]{64}$/.test(hash.trim()) ||
                                pay.isPending
                            }
                            onClick={() => pay.mutate()}
                        >
                            {pay.isPending ? "Saving…" : "Confirm paid"}
                        </Button>
                        <Button variant="ghost" onClick={() => setMode("")}>
                            Cancel
                        </Button>
                    </div>
                </div>
            )}
            {mode === "reject" && (
                <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
                    <Input
                        placeholder="Reason shown to the user"
                        value={reason}
                        maxLength={500}
                        onChange={(e) => setReason(e.target.value)}
                    />
                    <ErrorText error={reject.error} />
                    <div className="flex gap-2">
                        <Button
                            variant="danger"
                            disabled={!reason.trim() || reject.isPending}
                            onClick={() => reject.mutate()}
                        >
                            Reject
                        </Button>
                        <Button variant="ghost" onClick={() => setMode("")}>
                            Cancel
                        </Button>
                    </div>
                </div>
            )}
        </Card>
    );
}
