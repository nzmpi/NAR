import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtUsd, formatUnits, parseUnits } from "../lib/money";
import type { AdminPools, AdminWithdrawal } from "../lib/types";
import {
    Badge,
    Button,
    Card,
    ErrorText,
    Hint,
    Input,
    Mono,
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
            <div className="flex gap-1">
                {FILTERS.map((f) => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`rounded-full px-3 py-1 text-sm ${f === filter ? "bg-[var(--btn)] text-[var(--btn-fg)]" : "text-[var(--hint)]"}`}
                    >
                        {f}
                    </button>
                ))}
            </div>
            {q.isLoading && <Hint>Loading…</Hint>}
            <ErrorText error={q.error} />
            {q.data?.length === 0 && <Hint>Nothing here.</Hint>}
            <div className="space-y-3">
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
    const pay = useMutation({
        mutationFn: () =>
            api("/admin/withdrawals/" + w.id + "/paid", {
                method: "POST",
                body: {
                    txHash: hash.trim(),
                    reportedTotalUsd: total6!.toString(),
                },
            }),
        onSuccess: done,
    });
    const reject = useMutation({
        mutationFn: () =>
            api("/admin/withdrawals/" + w.id + "/reject", {
                method: "POST",
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
        <Card className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="font-medium">
                    {who}{" "}
                    <span className="text-[var(--hint)] font-normal text-sm">
                        · {new Date(w.createdAt).toLocaleString()}
                    </span>
                </div>
                <Badge status={w.status} />
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm tnum sm:grid-cols-4">
                <div>
                    <dt className="text-[var(--hint)]">Gross</dt>
                    <dd>${fmtUsd(w.grossAmountUsd)}</dd>
                </div>
                <div>
                    <dt className="text-[var(--hint)]">Early fee</dt>
                    <dd>${fmtUsd(w.earlyFeeUsd)}</dd>
                </div>
                <div>
                    <dt className="text-[var(--hint)]">Net (quoted)</dt>
                    <dd>${fmtUsd(w.netPayoutUsd)}</dd>
                </div>
                <div>
                    <dt className="text-[var(--hint)]">Send</dt>
                    <dd>{payout}</dd>
                </div>
            </dl>
            <div className="text-sm">
                <span className="text-[var(--hint)]">
                    To (chain {r.chainId}):{" "}
                </span>
                <Mono>{w.destinationAddress}</Mono>
            </div>
            {w.txHash && (
                <div className="text-sm">
                    <span className="text-[var(--hint)]">Tx: </span>
                    <Mono>{w.txHash}</Mono>
                </div>
            )}
            {w.rejectionReason && (
                <div className="text-sm text-[var(--bad)]">
                    {w.rejectionReason}
                </div>
            )}

            {w.status === "pending" && mode === "" && (
                <div className="flex gap-2">
                    <Button onClick={() => setMode("pay")}>Mark paid…</Button>
                    <Button variant="danger" onClick={() => setMode("reject")}>
                        Reject…
                    </Button>
                </div>
            )}
            {mode === "pay" && (
                <div className="space-y-2 rounded-lg border border-[var(--line)] p-3">
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
                <div className="space-y-2 rounded-lg border border-[var(--line)] p-3">
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
