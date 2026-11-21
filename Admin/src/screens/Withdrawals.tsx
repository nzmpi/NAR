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
    Segmented,
    Onchain,
} from "../components/ui";

const FILTERS = ["pending", "paid", "rejected", "cancelled", "all"] as const;

export function Withdrawals() {
    const [filter, setFilter] = useState<(typeof FILTERS)[number]>("pending");
    const q = useQuery({
        queryKey: ["admin-withdrawals", filter],
        queryFn: () =>
            api<AdminWithdrawal[]>(
                `/admin/withdrawals${filter === "all" ? "" : `?status=${filter}`}`,
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
        </div>
    );
}

function Row({ r, nav }: { r: AdminWithdrawal; nav?: string }) {
    const qc = useQueryClient();
    const w = r.withdrawal;
    const [mode, setMode] = useState<"" | "pay" | "reject">("");
    const [hash, setHash] = useState("");
    const [total, setTotal] = useState(
        nav ? formatUnits(nav, 6, 2).replaceAll(",", "") : "",
    );
    const [reason, setReason] = useState("");

    const done = () => {
        setMode("");
        for (const k of ["admin-withdrawals", "admin-pools"])
            qc.invalidateQueries({ queryKey: [k] });
    };
    const total6 = parseUnits(total, 6);
    const pay = useAction({
        mutationFn: (_, key) =>
            api("/admin/withdrawals/" + w.id + "/paid", {
                method: "POST",
                key,
                body: {
                    txHash: hash.trim(),
                    reportedTotalUsd: total6!.toString(),
                },
            }),
        onSuccess: done,
    });
    const lock = useAction({
        mutationFn: (_, key) =>
            api("/admin/withdrawals/" + w.id + "/lock", {
                method: "POST",
                key,
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
                    <dt className="text-xs text-[var(--hint)]">Net (quoted)</dt>
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

            {w.status === "pending" && w.lockedAt && (
                <Hint>
                    Locked: the user can no longer cancel. Send the funds, then
                    mark it paid.
                </Hint>
            )}
            {w.status === "pending" && mode === "" && (
                <div className="flex flex-wrap gap-2">
                    {w.lockedAt ? (
                        <Button onClick={() => setMode("pay")}>
                            Mark paid…
                        </Button>
                    ) : (
                        <Button
                            disabled={lock.isPending}
                            onClick={() => lock.mutate()}
                        >
                            Lock for payout
                        </Button>
                    )}
                    <Button variant="danger" onClick={() => setMode("reject")}>
                        Reject…
                    </Button>
                </div>
            )}
            <ErrorText error={lock.error} />
            {mode === "pay" && (
                <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
                    <Hint>
                        Send the funds first, then enter the transaction hash.
                        Final amounts use the settled pool price, so the paid
                        net can differ slightly from the quote.
                    </Hint>
                    <Input
                        placeholder="Payment tx hash 0x…"
                        value={hash}
                        onChange={(e) => setHash(e.target.value)}
                        className="font-mono"
                    />
                    <label className="block text-sm">
                        Total managed funds now (USD), counting this payout as
                        still managed
                        <Input
                            inputMode="decimal"
                            value={total}
                            onChange={(e) => setTotal(e.target.value)}
                            className="tnum mt-1"
                        />
                    </label>
                    <ErrorText error={pay.error} />
                    <div className="flex gap-2">
                        <Button
                            disabled={
                                !/^0x[a-fA-F0-9]{64}$/.test(hash.trim()) ||
                                total6 === null ||
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
