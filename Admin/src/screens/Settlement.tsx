import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, useAction } from "../lib/api";
import { fmtUsd, parseUnits } from "../lib/money";
import type { Tab } from "../App";
import type {
    AdminPools,
    AdminSettlement,
    AdminUser,
    AdminUserPortfolio,
    SettlementResult,
} from "../lib/types";
import {
    Button,
    Card,
    ErrorText,
    Hint,
    Input,
    Select,
    signedUsd,
    toneOf,
} from "../components/ui";

interface Bonus {
    lotId: string;
    label: string;
    amount: string;
}
export function Settlement({ go }: { go: (t: Tab) => void }) {
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
    const last = useQuery({
        queryKey: ["admin-settlements", false],
        queryFn: () => api<AdminSettlement[]>("/admin/settlements"),
    });

    const run = useAction({
        mutationFn: (reportedTotalUsd: string, key) =>
            api<SettlementResult>("/admin/settlements", {
                method: "POST",
                key,
                body: {
                    reportedTotalUsd,
                    confirmLargeMove: checked || undefined,
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
            for (const k of [
                "admin-pools",
                "admin-perf",
                "admin-user-pf",
                "admin-settlements",
            ])
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
    // Same rule as the server's large_move check (> 10%).
    const big =
        diff !== null &&
        current > 0n &&
        (diff < 0n ? -diff : diff) * 10n > current;
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

    const color = diff === null ? "var(--hint)" : (toneOf(diff) ?? "var(--fg)");
    const prev = last.data?.[0];

    return (
        <div className="flex flex-wrap items-start gap-4">
            <Card className="min-w-0 flex-[3_1_440px] space-y-5 p-6">
                <Hint>
                    Enter the current total USD value of all managed funds,
                    including funds still in user vaults and anything out for
                    payout. Profit is split across pools using this number. Time
                    is the server time, and it cannot be backdated.
                </Hint>
                <label className="flex flex-col gap-2">
                    <span className="font-semibold">New total (USD)</span>
                    <span className="flex h-[60px] items-center rounded-[14px] border-2 border-[var(--btn)] bg-[var(--field)] px-4 focus-within:ring-4 focus-within:ring-[var(--accent-soft)]">
                        <span className="display text-[26px] text-[var(--hint)]">
                            $
                        </span>
                        <input
                            inputMode="decimal"
                            value={value}
                            onChange={(e) => {
                                setValue(e.target.value);
                                setConfirm(false);
                            }}
                            placeholder="e.g. 12500.00"
                            className="display min-w-0 flex-1 bg-transparent pl-1.5 text-[26px] font-semibold outline-none tnum"
                        />
                    </span>
                </label>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-px overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--line)] tnum">
                    <div className="bg-[var(--card)] px-4 py-3.5">
                        <div className="text-xs text-[var(--hint)]">
                            Last recorded
                        </div>
                        <div className="mt-1 font-semibold">
                            ${fmtUsd(current)}
                        </div>
                    </div>
                    <div className="bg-[var(--card)] px-4 py-3.5">
                        <div className="text-xs text-[var(--hint)]">
                            {diff === null
                                ? "Profit / loss"
                                : diff >= 0n
                                  ? "Profit"
                                  : "Loss"}
                        </div>
                        <div className="mt-1 font-semibold" style={{ color }}>
                            {diff === null ? "–" : signedUsd(diff, fmtUsd)}
                        </div>
                    </div>
                    <div className="bg-[var(--card)] px-4 py-3.5">
                        <div className="text-xs text-[var(--hint)]">Change</div>
                        <div className="mt-1 font-semibold" style={{ color }}>
                            {pctChange === null
                                ? "–"
                                : `${pctChange > 0 ? "+" : pctChange < 0 ? "−" : ""}${Math.abs(pctChange)}%`}
                        </div>
                    </div>
                </div>
                {big && (
                    <label className="flex items-center gap-2.5 rounded-xl bg-[var(--warn-soft)] px-3.5 py-3 font-medium text-[var(--warn)]">
                        <input
                            type="checkbox"
                            className="h-[18px] w-[18px]"
                            checked={checked}
                            onChange={(e) => setChecked(e.target.checked)}
                        />
                        Change is over 10%. I have double-checked the number.
                    </label>
                )}

                <div className="space-y-2.5 border-t border-[var(--line)] pt-4">
                    <div className="font-semibold">
                        Bonuses{" "}
                        <span className="font-normal text-[var(--hint)]">
                            · optional
                        </span>
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

                <label className="flex flex-col gap-1.5 text-sm">
                    <span className="text-[13px] text-[var(--hint)]">
                        Note (optional)
                    </span>
                    <Input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={500}
                    />
                </label>
                <ErrorText error={run.error} />
                <div className="flex flex-wrap justify-end gap-2">
                    {!confirm ? (
                        <Button
                            className="!h-11 px-6"
                            disabled={!ok}
                            onClick={() => setConfirm(true)}
                        >
                            Review
                        </Button>
                    ) : (
                        <>
                            <Button
                                variant="ghost"
                                className="!h-11 px-5"
                                onClick={() => setConfirm(false)}
                            >
                                Back
                            </Button>
                            <Button
                                className="!h-11 px-6"
                                disabled={run.isPending}
                                onClick={() => run.mutate(next!.toString())}
                            >
                                {run.isPending
                                    ? "Recording…"
                                    : `Confirm $${fmtUsd(next!)}`}
                            </Button>
                        </>
                    )}
                </div>
            </Card>
            <aside className="flex min-w-0 flex-[2_1_300px] flex-col gap-3">
                {prev && (
                    <Card className="space-y-3 text-sm tnum">
                        <h2 className="display text-[17px] font-semibold">
                            Last settlement
                        </h2>
                        <div className="flex justify-between gap-3">
                            <span className="text-[var(--hint)]">When</span>
                            <span>
                                {new Date(prev.settledAt).toLocaleString()}
                            </span>
                        </div>
                        <div className="flex justify-between gap-3">
                            <span className="text-[var(--hint)]">Kind</span>
                            <span>{prev.kind}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                            <span className="text-[var(--hint)]">Result</span>
                            <span
                                className="font-semibold"
                                style={{ color: toneOf(BigInt(prev.pnlUsd)) }}
                            >
                                {signedUsd(BigInt(prev.pnlUsd), fmtUsd)}
                            </span>
                        </div>
                        <button
                            onClick={() => go("settlements")}
                            className="cursor-pointer font-semibold text-[var(--link)]"
                        >
                            See history →
                        </button>
                    </Card>
                )}
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
            </aside>
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
        <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
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
                            size="sm"
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
                    <Select
                        aria-label="Position"
                        value={lotId}
                        onChange={(e) => setLotId(e.target.value)}
                    >
                        <option value="">Position…</option>
                        {pf.data?.lots
                            .filter((l) => !taken.includes(l.lotId))
                            .map((l) => (
                                <option key={l.lotId} value={l.lotId}>
                                    {l.pool} · ${fmtUsd(l.valueUsd)}
                                </option>
                            ))}
                    </Select>
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
