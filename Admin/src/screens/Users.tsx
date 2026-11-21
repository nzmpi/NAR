import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, useAction } from "../lib/api";
import { downloadJson } from "../lib/download";
import { bpsPct, fmtUsd, formatUnits } from "../lib/money";
import type {
    AdminUser,
    AllowlistEntry,
    AdminUserPortfolio,
    AdminVault,
    VaultBalances,
} from "../lib/types";
import {
    Badge,
    Button,
    Card,
    ErrorText,
    Hint,
    Input,
    Mono,
    Pill,
    Segmented,
    Select,
    TD,
    TH,
} from "../components/ui";

const STATUS = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "blocked", label: "Blocked" },
] as const;
type Status = (typeof STATUS)[number]["id"];
type VaultFilter = "any" | "0" | "1" | "2" | "full";
const name = (u: AdminUser) => (u.username ? `@${u.username}` : u.telegramId);

export function Users() {
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState<Status>("all");
    const [vf, setVf] = useState<VaultFilter>("any");
    const [open, setOpen] = useState<string | null>(null);
    const q = useQuery({
        queryKey: ["admin-users"],
        queryFn: () => api<AdminUser[]>("/admin/users"),
    });
    const vaults = useQuery({
        queryKey: ["admin-vaults", "all"],
        queryFn: () => api<AdminVault[]>("/admin/vaults"),
    });
    const vaultCount = new Map<string, number>();
    for (const v of vaults.data ?? [])
        vaultCount.set(v.userId, (vaultCount.get(v.userId) ?? 0) + 1);

    const users = q.data ?? [];
    const s = search.trim().toLowerCase().replace(/^@/, "");
    const okVaults = (u: AdminUser) => {
        const n = vaultCount.get(u.id) ?? 0;
        if (vf === "any") return true;
        if (vf === "full") return n >= u.maxVaults;
        if (vf === "2") return n >= 2;
        return n === Number(vf);
    };
    const rows = users.filter(
        (u) =>
            (!s ||
                u.telegramId.includes(s) ||
                (u.username ?? "").toLowerCase().includes(s) ||
                u.id.startsWith(s)) &&
            (status === "all" || (status === "blocked") === u.isBlocked) &&
            okVaults(u),
    );
    const filtered = status !== "all" || vf !== "any";
    const sel = users.find((u) => u.id === open);

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-start gap-4">
                <section className="min-w-0 flex-[3_1_420px] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
                    <div className="flex flex-col gap-2.5 border-b border-[var(--line)] p-4">
                        <div className="flex flex-wrap items-center gap-2.5">
                            <Input
                                aria-label="Search users"
                                placeholder="Search by @username, Telegram ID or user ID"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="min-w-0 flex-[1_1_260px] !rounded-full px-4"
                            />
                            <span className="text-[13px] text-[var(--hint)]">
                                {filtered || s
                                    ? `${rows.length} of ${users.length} users`
                                    : `${users.length} users`}
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Segmented
                                label="Status"
                                value={status}
                                onChange={setStatus}
                                options={STATUS.map((o) => ({
                                    ...o,
                                    count:
                                        o.id === "all"
                                            ? users.length
                                            : users.filter(
                                                  (u) =>
                                                      (o.id === "blocked") ===
                                                      u.isBlocked,
                                              ).length,
                                }))}
                            />
                            <Select
                                aria-label="Vaults"
                                value={vf}
                                onChange={(e) =>
                                    setVf(e.target.value as VaultFilter)
                                }
                                className="!h-[38px] text-[13px] font-medium"
                            >
                                <option value="any">Any vaults</option>
                                <option value="0">No vault</option>
                                <option value="1">1 vault</option>
                                <option value="2">2+ vaults</option>
                                <option value="full">At vault limit</option>
                            </Select>
                            {filtered && (
                                <button
                                    onClick={() => {
                                        setStatus("all");
                                        setVf("any");
                                    }}
                                    className="h-[38px] cursor-pointer rounded-full px-3 text-[13px] font-semibold text-[var(--link)]"
                                >
                                    Clear filters
                                </button>
                            )}
                        </div>
                    </div>
                    {q.isLoading && (
                        <div className="p-5">
                            <Hint>Loading…</Hint>
                        </div>
                    )}
                    <div className="px-5">
                        <ErrorText error={q.error || vaults.error} />
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[480px] border-collapse">
                            <thead>
                                <tr>
                                    <th className={TH}>User</th>
                                    <th className={TH}>Joined</th>
                                    <th className={`${TH} text-right`}>
                                        Vaults
                                    </th>
                                    <th className={TH}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.slice(0, 100).map((u) => (
                                    <tr
                                        key={u.id}
                                        onClick={() => setOpen(u.id)}
                                        className={`cursor-pointer border-t border-[var(--row)] ${u.id === open ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--bg)]"}`}
                                    >
                                        <td className={TD}>
                                            <button
                                                onClick={() => setOpen(u.id)}
                                                aria-pressed={u.id === open}
                                                className="cursor-pointer text-left font-semibold"
                                            >
                                                {name(u)}
                                            </button>
                                            <div className="text-xs text-[var(--hint)]">
                                                tg {u.telegramId}
                                            </div>
                                        </td>
                                        <td
                                            className={`${TD} text-[var(--soft)]`}
                                        >
                                            {new Date(
                                                u.createdAt,
                                            ).toLocaleDateString()}
                                        </td>
                                        <td className={`${TD} text-right`}>
                                            {vaults.data
                                                ? `${vaultCount.get(u.id) ?? 0} / ${u.maxVaults}`
                                                : `– / ${u.maxVaults}`}
                                        </td>
                                        <td className={TD}>
                                            <Pill
                                                tone={
                                                    u.isBlocked ? "bad" : "good"
                                                }
                                            >
                                                {u.isBlocked
                                                    ? "Blocked"
                                                    : "Active"}
                                            </Pill>
                                        </td>
                                    </tr>
                                ))}
                                {!q.isLoading && rows.length === 0 && (
                                    <tr className="border-t border-[var(--row)]">
                                        <td
                                            colSpan={4}
                                            className="px-4 py-7 text-center text-[var(--hint)]"
                                        >
                                            No users match these filters.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    {rows.length > 100 && (
                        <div className="border-t border-[var(--row)] px-5 py-3">
                            <Hint>
                                Showing the first 100. Search to narrow it down.
                            </Hint>
                        </div>
                    )}
                </section>

                <aside
                    aria-label="Selected user"
                    className="min-w-0 flex-[2_1_340px] rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5"
                >
                    {sel ? (
                        <UserDetail key={sel.id} u={sel} />
                    ) : (
                        <Hint>
                            Select a user to see their balance, positions and
                            vaults.
                        </Hint>
                    )}
                </aside>
            </div>
            <Allowlist />
        </div>
    );
}

function Allowlist() {
    const qc = useQueryClient();
    const [tg, setTg] = useState("");
    const [note, setNote] = useState("");
    const list = useQuery({
        queryKey: ["admin-allowlist"],
        queryFn: () => api<AllowlistEntry[]>("/admin/allowlist"),
    });
    const done = () => qc.invalidateQueries({ queryKey: ["admin-allowlist"] });
    const add = useAction({
        mutationFn: (_, key) =>
            api("/admin/allowlist", {
                method: "POST",
                key,
                body: { telegramId: tg.trim(), note: note.trim() || undefined },
            }),
        onSuccess: () => {
            setTg("");
            setNote("");
            done();
        },
    });
    const remove = useAction({
        mutationFn: (id: string, key) =>
            api(`/admin/allowlist/${id}/remove`, { method: "POST", key }),
        onSuccess: done,
    });

    return (
        <Card className="space-y-3.5">
            <h2 className="display text-[17px] font-semibold">
                Invite allowlist
            </h2>
            <Hint>
                In prod only these Telegram IDs can sign up. Removing an ID
                stops sign-up only; block the user to cut existing access.
            </Hint>
            <div className="flex flex-wrap gap-2">
                <Input
                    aria-label="Telegram ID"
                    placeholder="Telegram ID"
                    inputMode="numeric"
                    value={tg}
                    onChange={(e) => setTg(e.target.value)}
                    className="flex-[1_1_180px] tnum"
                />
                <Input
                    aria-label="Note"
                    className="flex-[2_1_260px]"
                    placeholder="Note (optional)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                />
                <Button
                    disabled={!/^[0-9]{1,20}$/.test(tg.trim()) || add.isPending}
                    onClick={() => add.mutate()}
                >
                    Add to allowlist
                </Button>
            </div>
            <div className="flex flex-wrap gap-2">
                {list.data?.map((a) => (
                    <span
                        key={a.telegramId}
                        className="inline-flex h-[34px] items-center gap-2 rounded-full border border-[var(--line)] pr-1.5 pl-3.5 text-sm tnum"
                    >
                        <span>
                            {a.telegramId}
                            {a.note && (
                                <span className="text-[var(--hint)]">
                                    {" "}
                                    · {a.note}
                                </span>
                            )}
                        </span>
                        <button
                            aria-label={`Remove ${a.telegramId}`}
                            className="h-6 w-6 cursor-pointer rounded-full bg-[var(--muted-soft)] text-[13px] font-semibold text-[var(--soft)] disabled:opacity-50"
                            disabled={remove.isPending}
                            onClick={() => {
                                if (
                                    confirm(
                                        `Remove ${a.telegramId} from the allowlist?`,
                                    )
                                )
                                    remove.mutate(a.telegramId);
                            }}
                        >
                            ×
                        </button>
                    </span>
                ))}
            </div>
            {list.data?.length === 0 && <Hint>No invited IDs.</Hint>}
            <ErrorText error={list.error || add.error || remove.error} />
        </Card>
    );
}

function UserDetail({ u }: { u: AdminUser }) {
    const qc = useQueryClient();
    const pf = useQuery({
        queryKey: ["admin-user-pf", u.id],
        queryFn: () =>
            api<AdminUserPortfolio>(`/admin/users/${u.id}/portfolio`),
    });
    const vaults = useQuery({
        queryKey: ["admin-vaults", u.id],
        queryFn: () => api<AdminVault[]>(`/admin/vaults?userId=${u.id}`),
    });
    const block = useAction({
        mutationFn: (_, key) =>
            api(`/admin/users/${u.id}/blocked`, {
                method: "POST",
                key,
                body: { isBlocked: !u.isBlocked },
            }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
    });
    const addVault = useAction({
        mutationFn: (_, key) =>
            api(`/admin/users/${u.id}/vaults`, { method: "POST", key }),
        // Prefix match also refreshes the vault counts in the list.
        onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-vaults"] }),
    });
    const H =
        "mb-2 text-xs font-semibold tracking-wider text-[var(--hint)] uppercase";

    return (
        <div className="space-y-5 tnum">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="display text-xl font-semibold">
                        {name(u)}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--hint)]">
                        tg {u.telegramId} · user ID <Mono>{u.id}</Mono>
                    </div>
                </div>
                <Pill tone={u.isBlocked ? "bad" : "good"}>
                    {u.isBlocked ? "Blocked" : "Active"}
                </Pill>
            </div>

            {pf.isLoading && <Hint>Loading…</Hint>}
            {pf.data && (
                <>
                    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--line)]">
                        <div className="bg-[var(--card)] p-3">
                            <div className="text-xs text-[var(--hint)]">
                                Balance
                            </div>
                            <div className="mt-0.5 font-semibold">
                                ${fmtUsd(pf.data.totalBalanceUsd)}
                            </div>
                        </div>
                        <div className="bg-[var(--card)] p-3">
                            <div className="text-xs text-[var(--hint)]">
                                Earned
                            </div>
                            <div className="mt-0.5 font-semibold text-[var(--good)]">
                                ${fmtUsd(pf.data.accruedYieldUsd)}
                            </div>
                        </div>
                        <div className="bg-[var(--card)] p-3">
                            <div className="text-xs text-[var(--hint)]">
                                Projected
                            </div>
                            <div className="mt-0.5 font-semibold">
                                {pf.data.projectedApyBps === null
                                    ? "–"
                                    : bpsPct(pf.data.projectedApyBps)}
                            </div>
                        </div>
                    </div>
                    <div>
                        <h3 className={H}>Positions</h3>
                        {pf.data.lots.map((l) => (
                            <div
                                key={l.lotId}
                                className="flex justify-between border-b border-[var(--row)] py-2 text-sm last:border-b-0"
                            >
                                <span>
                                    {l.pool}
                                    {l.maturesAt && (
                                        <span className="text-[var(--hint)]">
                                            {" "}
                                            · until{" "}
                                            {new Date(
                                                l.maturesAt,
                                            ).toLocaleDateString()}
                                        </span>
                                    )}
                                </span>
                                <span className="font-semibold">
                                    ${fmtUsd(l.valueUsd)}
                                </span>
                            </div>
                        ))}
                        {pf.data.lots.length === 0 && (
                            <Hint>No positions.</Hint>
                        )}
                    </div>
                </>
            )}
            <ErrorText error={pf.error} />

            <div className="space-y-2">
                <h3 className={H}>Vaults · limit {u.maxVaults}</h3>
                {vaults.data?.map((v) => (
                    <VaultRow key={v.id} v={v} userId={u.id} />
                ))}
                <ErrorText error={vaults.error} />
            </div>

            <div className="flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
                <Button
                    variant="ghost"
                    disabled={addVault.isPending}
                    onClick={() => {
                        if (
                            confirm(
                                "Allow and create one more vault for this user? Vault addresses are permanent.",
                            )
                        )
                            addVault.mutate();
                    }}
                >
                    Add vault
                </Button>
                <Button
                    className="ml-auto"
                    variant={u.isBlocked ? "ghost" : "danger"}
                    disabled={block.isPending}
                    onClick={() => {
                        if (
                            confirm(
                                u.isBlocked
                                    ? "Unblock this user?"
                                    : "Block this user? They will lose access to the app.",
                            )
                        )
                            block.mutate();
                    }}
                >
                    {u.isBlocked ? "Unblock user" : "Block user"}
                </Button>
            </div>
            <ErrorText error={block.error || addVault.error} />
        </div>
    );
}

function VaultRow({ v, userId }: { v: AdminVault; userId: string }) {
    const qc = useQueryClient();
    const [hash, setHash] = useState("");
    const [mode, setMode] = useState<"" | "deployed">("");
    const bal = useMutation({
        mutationFn: () => api<VaultBalances>(`/admin/vaults/${v.id}/balances`),
    });
    const batch = useMutation({
        mutationFn: () =>
            api<{ safeBatch: unknown }>("/admin/vaults/deploy-calldata", {
                method: "POST",
                body: { vaultIds: [v.id] },
            }),
        onSuccess: (r) =>
            downloadJson(
                `deploy-${v.chainName}-${v.address.slice(0, 8)}.json`,
                r.safeBatch,
            ),
    });
    const deployed = useAction({
        mutationFn: (_, key) =>
            api(`/admin/vaults/${v.id}/deployed`, {
                method: "POST",
                key,
                body: { deployTxHash: hash.trim() },
            }),
        onSuccess: () => {
            setMode("");
            qc.invalidateQueries({ queryKey: ["admin-vaults", userId] });
        },
    });

    return (
        <div className="space-y-2.5 rounded-xl border border-[var(--line)] p-3">
            <div className="flex items-center justify-between text-sm">
                <span>
                    <b>{v.chainName}</b>{" "}
                    <span className="text-[var(--hint)]">
                        · nonce {v.nonce}
                    </span>
                </span>
                <Badge status={v.isDeployed ? "deployed" : "not deployed"} />
            </div>
            <Mono>{v.address}</Mono>
            <div className="flex flex-wrap gap-2">
                <Button
                    size="sm"
                    variant="ghost"
                    disabled={bal.isPending}
                    onClick={() => bal.mutate()}
                >
                    {bal.isPending ? "Reading…" : "Balances"}
                </Button>
                {!v.isDeployed && (
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={batch.isPending}
                        onClick={() => batch.mutate()}
                    >
                        Deploy batch (JSON)
                    </Button>
                )}
                {!v.isDeployed && (
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setMode(mode ? "" : "deployed")}
                    >
                        Mark deployed…
                    </Button>
                )}
            </div>
            {mode === "deployed" && (
                <div className="flex gap-2">
                    <Input
                        placeholder="Deploy tx hash 0x…"
                        value={hash}
                        onChange={(e) => setHash(e.target.value)}
                        className="font-mono"
                    />
                    <Button
                        disabled={
                            !/^0x[a-fA-F0-9]{64}$/.test(hash.trim()) ||
                            deployed.isPending
                        }
                        onClick={() => deployed.mutate()}
                    >
                        Save
                    </Button>
                </div>
            )}
            {bal.data && (
                <div className="space-y-1 text-sm tnum">
                    {bal.data.balances.map((b) => (
                        <div key={b.assetId}>
                            {b.symbol}: {formatUnits(b.balance, b.decimals, 4)}
                        </div>
                    ))}
                    <div>Native: {formatUnits(bal.data.native, 18, 6)}</div>
                </div>
            )}
            <ErrorText error={bal.error || batch.error || deployed.error} />
        </div>
    );
}
