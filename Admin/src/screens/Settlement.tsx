import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtUsd, parseUnits } from "../lib/money";
import type { AdminPools, SettlementResult } from "../lib/types";
import { Button, Card, ErrorText, Hint, Input } from "../components/ui";

export function Settlement() {
    const qc = useQueryClient();
    const pools = useQuery({
        queryKey: ["admin-pools"],
        queryFn: () => api<AdminPools>("/admin/pools"),
    });
    const [value, setValue] = useState("");
    const [note, setNote] = useState("");
    const [checked, setChecked] = useState(false);
    const [confirm, setConfirm] = useState(false);

    const run = useMutation({
        mutationFn: (reportedTotalUsd: string) =>
            api<SettlementResult>("/admin/settlements", {
                method: "POST",
                body: { reportedTotalUsd, note: note || undefined },
            }),
        onSuccess: () => {
            setValue("");
            setNote("");
            setChecked(false);
            setConfirm(false);
            qc.invalidateQueries({ queryKey: ["admin-pools"] });
            qc.invalidateQueries({ queryKey: ["admin-perf"] });
        },
    });

    if (pools.isLoading) return <Hint>Loading…</Hint>;
    if (pools.error) return <ErrorText error={pools.error} />;
    const current = BigInt(pools.data!.totalAssetsUsd);
    const next = parseUnits(value, 6);
    const diff = next === null ? null : next - current;
    const pctChange =
        diff !== null && current > 0n
            ? Number((diff * 10_000n) / current) / 100
            : null;
    const big = pctChange !== null && Math.abs(pctChange) > 10;
    const ok = next !== null && next > 0n && (!big || checked);

    return (
        <div className="max-w-xl space-y-4">
            <Card className="space-y-3">
                <h2 className="font-medium">Record settlement</h2>
                <Hint>
                    Enter the current total USD value of all managed funds,
                    including funds still in user vaults and anything out for
                    payout. Profit is split across pools using this number. Time
                    is the server time, and it cannot be backdated.
                </Hint>
                <div className="text-sm">
                    Last recorded total:{" "}
                    <b className="tnum">${fmtUsd(current)}</b>
                </div>
                <label className="block text-sm">
                    New total (USD)
                    <Input
                        inputMode="decimal"
                        value={value}
                        onChange={(e) => {
                            setValue(e.target.value);
                            setConfirm(false);
                        }}
                        placeholder="e.g. 12500.00"
                        className="tnum mt-1"
                    />
                </label>
                {diff !== null && (
                    <div
                        className="text-sm tnum"
                        style={{
                            color: diff >= 0n ? "var(--good)" : "var(--bad)",
                        }}
                    >
                        {diff >= 0n ? "Profit" : "Loss"}:{" "}
                        {diff >= 0n ? "+" : "-"}$
                        {fmtUsd(diff >= 0n ? diff : -diff)}
                        {pctChange !== null &&
                            ` (${pctChange >= 0 ? "+" : ""}${pctChange}%)`}
                    </div>
                )}
                {big && (
                    <label className="flex items-center gap-2 text-sm text-[var(--warn)]">
                        <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => setChecked(e.target.checked)}
                        />
                        Change is over 10%. I have double-checked the number.
                    </label>
                )}
                <label className="block text-sm">
                    Note (optional)
                    <Input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={500}
                        className="mt-1"
                    />
                </label>
                <ErrorText error={run.error} />
                {!confirm ? (
                    <Button disabled={!ok} onClick={() => setConfirm(true)}>
                        Review
                    </Button>
                ) : (
                    <div className="flex gap-2">
                        <Button
                            disabled={run.isPending}
                            onClick={() => run.mutate(next!.toString())}
                        >
                            {run.isPending
                                ? "Recording…"
                                : `Confirm $${fmtUsd(next!)}`}
                        </Button>
                        <Button
                            variant="ghost"
                            onClick={() => setConfirm(false)}
                        >
                            Back
                        </Button>
                    </div>
                )}
            </Card>
            {run.data && (
                <Card>
                    <div className="text-sm">
                        Recorded. P&L{" "}
                        <b className="tnum">${fmtUsd(run.data.pnlUsd)}</b>
                        {run.data.convertedLots.length > 0 && (
                            <>
                                {" "}
                                · {run.data.convertedLots.length} matured
                                position(s) moved to liquid
                            </>
                        )}
                    </div>
                </Card>
            )}
        </div>
    );
}
