import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtUsd, formatUnits } from "../lib/money";
import { POOL_LABEL, type Intent } from "../lib/types";
import { useAssets, useRelocks, useWithdrawals } from "../lib/queries";
import { ErrorText, Hint, StatusBadge } from "../components/ui";

interface Item {
    t: string;
    title: string;
    amount: string;
    status: string;
    note?: string;
}

export function History() {
    const assets = useAssets();
    const deposits = useQuery({
        queryKey: ["deposits"],
        queryFn: () => api<Intent[]>("/me/deposits"),
    });
    const wd = useWithdrawals();
    const rl = useRelocks();

    if (assets.isLoading || deposits.isLoading || wd.isLoading || rl.isLoading)
        return <Hint>Loading…</Hint>;
    const err = assets.error || deposits.error || wd.error || rl.error;
    if (err) return <ErrorText error={err} />;

    const items: Item[] = [
        ...deposits
            .data!.filter(
                (d) => d.status !== "cancelled" && d.status !== "expired",
            )
            .map((d) => {
                const a = assets.data!.find((x) => x.assetId === d.assetId);
                return {
                    t: d.createdAt,
                    title: "Deposit",
                    status: d.status,
                    amount: d.confirmedAmountUsd
                        ? `+$${fmtUsd(d.confirmedAmountUsd)}`
                        : `${formatUnits(d.intendedAmount, a?.decimals ?? 6, 2)} ${a?.symbol ?? ""}`,
                    note: d.allocations
                        .map((x) => `${POOL_LABEL[x.pool]} ${x.bps / 100}%`)
                        .join(", "),
                };
            }),
        ...wd.data!.map((w) => ({
            t: w.createdAt,
            title: "Withdrawal",
            status: w.status,
            amount: `-$${fmtUsd(w.grossAmountUsd)}`,
            note:
                BigInt(w.earlyFeeUsd) > 0n
                    ? `fee $${fmtUsd(w.earlyFeeUsd)}`
                    : undefined,
        })),
        ...rl.data!.map((r) => ({
            t: r.createdAt,
            title: "Relock",
            status: r.status,
            amount: "",
            note: r.items
                .map((i) => (i.targetPool ? POOL_LABEL[i.targetPool] : ""))
                .join(", "),
        })),
    ].sort((a, b) => b.t.localeCompare(a.t));

    if (!items.length) return <Hint>No activity yet.</Hint>;
    return (
        <div className="space-y-2">
            {items.map((it, k) => (
                <div key={k} className="rounded-2xl p-3 bg-[var(--bg2)]">
                    <div className="flex justify-between items-center">
                        <span className="font-medium">{it.title}</span>
                        <span className="tnum">{it.amount}</span>
                    </div>
                    <div className="flex justify-between items-center mt-1">
                        <span className="text-xs text-[var(--hint)]">
                            {new Date(it.t).toLocaleString()}
                            {it.note && ` · ${it.note}`}
                        </span>
                        <StatusBadge status={it.status} />
                    </div>
                </div>
            ))}
        </div>
    );
}
