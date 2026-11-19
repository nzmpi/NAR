import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
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
} from "../components/ui";

export function Users() {
    const [search, setSearch] = useState("");
    const [open, setOpen] = useState<string | null>(null);
    const q = useQuery({
        queryKey: ["admin-users"],
        queryFn: () => api<AdminUser[]>("/admin/users"),
    });
    const s = search.trim().toLowerCase().replace(/^@/, "");
    const rows = (q.data ?? []).filter(
        (u) =>
            !s ||
            u.telegramId.includes(s) ||
            (u.username ?? "").toLowerCase().includes(s) ||
            u.id.startsWith(s),
    );

    return (
        <div className="space-y-3">
            <Allowlist />
            <Input
                placeholder="Search by @username, Telegram ID or user ID"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
            />
            {q.isLoading && <Hint>Loading…</Hint>}
            <ErrorText error={q.error} />
            <Hint>{rows.length} user(s)</Hint>
            {rows.slice(0, 100).map((u) => (
                <Card key={u.id} className="space-y-3">
                    <button
                        className="flex w-full items-center justify-between text-left"
                        onClick={() => setOpen(open === u.id ? null : u.id)}
                    >
                        <span className="font-medium">
                            {u.username ? `@${u.username}` : u.telegramId}
                            <span className="ml-2 text-sm font-normal text-[var(--hint)]">
                                tg {u.telegramId} · joined{" "}
                                {new Date(u.createdAt).toLocaleDateString()}
                            </span>
                        </span>
                        {u.isBlocked && <Badge status="blocked" />}
                    </button>
                    {open === u.id && <UserDetail u={u} />}
                </Card>
            ))}
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
    const add = useMutation({
        mutationFn: () =>
            api("/admin/allowlist", {
                method: "POST",
                body: { telegramId: tg.trim(), note: note.trim() || undefined },
            }),
        onSuccess: () => {
            setTg("");
            setNote("");
            done();
        },
    });
    const remove = useMutation({
        mutationFn: (id: string) =>
            api(`/admin/allowlist/${id}/remove`, { method: "POST" }),
        onSuccess: done,
    });

    return (
        <Card className="space-y-3">
            <h3 className="font-medium">Invite allowlist</h3>
            <Hint>
                In prod only these Telegram IDs can sign up. Removing an ID
                stops sign-up only; block the user to cut existing access.
            </Hint>
            <div className="flex flex-wrap gap-2">
                <Input
                    placeholder="Telegram ID"
                    inputMode="numeric"
                    value={tg}
                    onChange={(e) => setTg(e.target.value)}
                    className="font-mono"
                />
                <Input
                    placeholder="Note (optional)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                />
                <Button
                    disabled={!/^[0-9]{1,20}$/.test(tg.trim()) || add.isPending}
                    onClick={() => add.mutate()}
                >
                    Add
                </Button>
            </div>
            {list.data?.map((a) => (
                <div
                    key={a.telegramId}
                    className="flex items-center justify-between text-sm"
                >
                    <span>
                        <Mono>{a.telegramId}</Mono>
                        {a.note && (
                            <span className="text-[var(--hint)]">
                                {" "}
                                · {a.note}
                            </span>
                        )}
                    </span>
                    <Button
                        variant="ghost"
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
                        Remove
                    </Button>
                </div>
            ))}
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
    const block = useMutation({
        mutationFn: () =>
            api(`/admin/users/${u.id}/blocked`, {
                method: "POST",
                body: { isBlocked: !u.isBlocked },
            }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
    });
    const addVault = useMutation({
        mutationFn: () =>
            api(`/admin/users/${u.id}/vaults`, { method: "POST" }),
        onSuccess: () =>
            qc.invalidateQueries({ queryKey: ["admin-vaults", u.id] }),
    });

    return (
        <div className="space-y-4 border-t border-[var(--line)] pt-3">
            <div className="text-sm text-[var(--hint)]">
                User ID <Mono>{u.id}</Mono> · vault limit {u.maxVaults}
            </div>

            {pf.data && (
                <div className="space-y-2">
                    <div className="text-sm">
                        Balance{" "}
                        <b className="tnum">
                            ${fmtUsd(pf.data.totalBalanceUsd)}
                        </b>{" "}
                        · earned{" "}
                        <span className="tnum">
                            ${fmtUsd(pf.data.accruedYieldUsd)}
                        </span>
                        {pf.data.projectedApyBps !== null && (
                            <> · projected {bpsPct(pf.data.projectedApyBps)}</>
                        )}
                    </div>
                    {pf.data.lots.map((l) => (
                        <div
                            key={l.lotId}
                            className="flex justify-between text-sm tnum"
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
                            <span>${fmtUsd(l.valueUsd)}</span>
                        </div>
                    ))}
                    {pf.data.lots.length === 0 && <Hint>No positions.</Hint>}
                </div>
            )}
            <ErrorText error={pf.error} />

            <div className="space-y-2">
                <h3 className="font-medium">Vaults</h3>
                {vaults.data?.map((v) => (
                    <VaultRow key={v.id} v={v} userId={u.id} />
                ))}
                <ErrorText error={vaults.error} />
            </div>

            <div className="flex flex-wrap gap-2">
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
                    {u.isBlocked ? "Unblock" : "Block"}
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
    const deployed = useMutation({
        mutationFn: () =>
            api(`/admin/vaults/${v.id}/deployed`, {
                method: "POST",
                body: { deployTxHash: hash.trim() },
            }),
        onSuccess: () => {
            setMode("");
            qc.invalidateQueries({ queryKey: ["admin-vaults", userId] });
        },
    });

    return (
        <div className="space-y-2 rounded-lg border border-[var(--line)] p-3">
            <div className="flex items-center justify-between text-sm">
                <span>
                    <b>{v.chainName}</b> · nonce {v.nonce}
                </span>
                <Badge status={v.isDeployed ? "deployed" : "not deployed"} />
            </div>
            <Mono>{v.address}</Mono>
            <div className="flex flex-wrap gap-2">
                <Button
                    variant="ghost"
                    disabled={bal.isPending}
                    onClick={() => bal.mutate()}
                >
                    {bal.isPending ? "Reading…" : "Balances"}
                </Button>
                {!v.isDeployed && (
                    <Button
                        variant="ghost"
                        disabled={batch.isPending}
                        onClick={() => batch.mutate()}
                    >
                        Deploy batch (JSON)
                    </Button>
                )}
                {!v.isDeployed && (
                    <Button
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
