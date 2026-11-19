import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtUsd, parseUnits } from "../lib/money";
import type {
    AdminPools,
    AdminUser,
    AdminUserPortfolio,
    SettlementResult,
} from "../lib/types";
import { Button, Card, ErrorText, Hint, Input } from "../components/ui";

interface Bonus {
    lotId: string;
    label: string;
    amount: string;
}
const selCls =
    "rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm";

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
    const [bonuses, setBonuses] = useState<Bonus[]>([]);

    const run = useMutation({
        mutationFn: (reportedTotalUsd: string) =>
            api<SettlementResult>("/admin/settlements", {
                method: "POST",
                body: {
                    reportedTotalUsd,
                    note: note || undefined,
                    bonuses: bonuses.length
                        ? bonuses.map((b) => ({
                              lotId: b.lotId,
                              amountUsd: parseUnits(b.amount, 6)!.toString(),
                          }))
                        : undefined,
                },
            }),
        onSuccess: () => {
            setValue("");
            setNote("");
            setChecked(false);
            setConfirm(false);
            setBonuses([]);
            for (const k of ["admin-pools", "admin-perf", "admin-user-pf"])
                qc.invalidateQueries({ queryKey: [k] });
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
    const bonusTotal = bonuses.reduce(
        (s, b) => s + (parseUnits(b.amount, 6) ?? 0n),
        0n,
    );
    const bonusOk =
        bonuses.length === 0 ||
        (diff !== null &&
            diff > 0n &&
            bonuses.every((b) => (parseUnits(b.amount, 6) ?? 0n) > 0n));
    const ok = next !== null && next > 0n && (!big || checked) && bonusOk;

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

                <div className="space-y-2 border-t border-[var(--line)] pt-3">
                    <div className="text-sm font-medium">
                        Bonuses (optional)
                    </div>
                    <Hint>
                        Credit extra yield to a user's position, paid from the
                        manager pool. Only possible when the settlement shows a
                        profit.
                    </Hint>
                    {bonuses.map((b, k) => (
                        <div
                            key={k}
                            className="flex items-center gap-2 text-sm"
                        >
                            <span className="flex-1">{b.label}</span>
                            <Input
                                inputMode="decimal"
                                value={b.amount}
                                className="w-28 tnum"
                                onChange={(e) => {
                                    setBonuses(
                                        bonuses.map((x, j) =>
                                            j === k
                                                ? {
                                                      ...x,
                                                      amount: e.target.value,
                                                  }
                                                : x,
                                        ),
                                    );
                                    setConfirm(false);
                                }}
                            />
                            <Button
                                variant="ghost"
                                onClick={() => {
                                    setBonuses(
                                        bonuses.filter((_, j) => j !== k),
                                    );
                                    setConfirm(false);
                                }}
                            >
                                Remove
                            </Button>
                        </div>
                    ))}
                    {bonuses.length > 0 && (
                        <div className="text-sm tnum">
                            Total bonuses: ${fmtUsd(bonusTotal)}
                        </div>
                    )}
                    {bonuses.length > 0 && !bonusOk && (
                        <p className="text-sm text-[var(--bad)]">
                            Bonuses need a profit and positive amounts.
                        </p>
                    )}
                    <AddBonus
                        onAdd={(b) => {
                            setBonuses([...bonuses, b]);
                            setConfirm(false);
                        }}
                        taken={bonuses.map((b) => b.lotId)}
                    />
                </div>

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

function AddBonus({
    onAdd,
    taken,
}: {
    onAdd: (b: Bonus) => void;
    taken: string[];
}) {
    const [search, setSearch] = useState("");
    const [userId, setUserId] = useState("");
    const [lotId, setLotId] = useState("");
    const [amount, setAmount] = useState("");
    const users = useQuery({
        queryKey: ["admin-users"],
        queryFn: () => api<AdminUser[]>("/admin/users"),
    });
    const pf = useQuery({
        queryKey: ["admin-user-pf", userId],
        queryFn: () =>
            api<AdminUserPortfolio>(`/admin/users/${userId}/portfolio`),
        enabled: !!userId,
    });

    const s = search.trim().toLowerCase().replace(/^@/, "");
    const matches = s
        ? (users.data ?? [])
              .filter(
                  (u) =>
                      u.telegramId.includes(s) ||
                      (u.username ?? "").toLowerCase().includes(s),
              )
              .slice(0, 8)
        : [];
    const user = users.data?.find((u) => u.id === userId);
    const lot = pf.data?.lots.find((l) => l.lotId === lotId);
    const amt = parseUnits(amount, 6);

    return (
        <div className="space-y-2 rounded-lg border border-[var(--line)] p-3">
            <Input
                placeholder="Find user (@username or Telegram ID)"
                value={search}
                onChange={(e) => {
                    setSearch(e.target.value);
                    setUserId("");
                    setLotId("");
                }}
            />
            {!userId && matches.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {matches.map((u) => (
                        <Button
                            key={u.id}
                            variant="ghost"
                            onClick={() => {
                                setUserId(u.id);
                                setSearch(
                                    u.username
                                        ? `@${u.username}`
                                        : u.telegramId,
                                );
                            }}
                        >
                            {u.username ? `@${u.username}` : u.telegramId}
                        </Button>
                    ))}
                </div>
            )}
            {userId && (
                <div className="flex flex-wrap gap-2">
                    <select
                        value={lotId}
                        onChange={(e) => setLotId(e.target.value)}
                        className={selCls}
                    >
                        <option value="">Position…</option>
                        {pf.data?.lots
                            .filter((l) => !taken.includes(l.lotId))
                            .map((l) => (
                                <option key={l.lotId} value={l.lotId}>
                                    {l.pool} · ${fmtUsd(l.valueUsd)}
                                </option>
                            ))}
                    </select>
                    <Input
                        placeholder="Bonus USD"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-32 tnum"
                    />
                    <Button
                        disabled={!lot || !amt || amt <= 0n}
                        onClick={() => {
                            onAdd({
                                lotId,
                                amount,
                                label: `${user?.username ? "@" + user.username : user?.telegramId} · ${lot!.pool}`,
                            });
                            setAmount("");
                            setLotId("");
                        }}
                    >
                        Add bonus
                    </Button>
                </div>
            )}
        </div>
    );
}
