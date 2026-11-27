import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, useAction } from "../lib/api";
import { formatUnits } from "../lib/money";
import type { AdminChain, AdminDeposit, AdminTransfer } from "../lib/types";
import {
    Button,
    Card,
    ErrorText,
    Hint,
    Input,
    Onchain,
    Select,
    Warn,
} from "../components/ui";

const OPEN = ["intent", "transfer_detected"];

export function Transfers() {
    const qc = useQueryClient();
    const transfers = useQuery({
        queryKey: ["admin-transfers"],
        queryFn: () => api<AdminTransfer[]>("/admin/transfers?unmatched=true"),
        refetchInterval: 30_000,
    });
    const deposits = useQuery({
        queryKey: ["admin-deposits"],
        queryFn: () => api<AdminDeposit[]>("/admin/deposits"),
    });
    const chains = useQuery({
        queryKey: ["admin-chains"],
        queryFn: () => api<AdminChain[]>("/admin/chains"),
    });

    const refresh = () => {
        for (const k of ["admin-transfers", "admin-deposits"])
            qc.invalidateQueries({ queryKey: [k] });
    };
    const deps = deposits.data ?? [];

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="display text-[17px] font-semibold">
                    Unmatched transfers
                </h2>
                <Hint>
                    Incoming transfers to user vaults that could not be matched
                    to a single open deposit intent.
                </Hint>
            </div>
            {transfers.isLoading && <Hint>Loading…</Hint>}
            <ErrorText error={transfers.error} />
            {transfers.data?.length === 0 && (
                <Hint>All transfers are matched.</Hint>
            )}
            <div className="space-y-3">
                {transfers.data?.map((t) => (
                    <TransferRow
                        key={t.id}
                        t={t}
                        chainId={
                            chains.data?.find((c) => c.id === t.chainId)
                                ?.chainId
                        }
                        deps={deps}
                        onDone={refresh}
                    />
                ))}
            </div>
            <Ingest chains={chains.data ?? []} onDone={refresh} />
        </div>
    );
}

function TransferRow({
    t,
    chainId,
    deps,
    onDone,
}: {
    t: AdminTransfer;
    chainId?: number;
    deps: AdminDeposit[];
    onDone: () => void;
}) {
    const asset = deps.find((d) => d.intent.assetId === t.assetId);
    const candidates = deps.filter(
        (d) =>
            d.intent.vaultId === t.vaultId &&
            d.intent.assetId === t.assetId &&
            OPEN.includes(d.intent.status),
    );
    const [pick, setPick] = useState("");
    const match = useAction({
        mutationFn: (_, key) =>
            api(`/admin/transfers/${t.id}/match`, {
                method: "POST",
                key,
                body: { intentId: pick },
            }),
        onSuccess: onDone,
    });
    return (
        <Card className="space-y-3">
            <div className="flex flex-wrap justify-between gap-2">
                <b className="display text-lg tnum">
                    {asset
                        ? `${formatUnits(t.amount, asset.decimals, 2)} ${asset.symbol}`
                        : `${t.amount} (raw)`}
                </b>
                <span className="text-sm text-[var(--hint)]">
                    {new Date(t.createdAt).toLocaleString()}
                </span>
            </div>
            <div className="text-sm">
                <span className="text-[var(--hint)]">Tx: </span>
                <Onchain value={t.txHash} chainId={chainId} />
            </div>
            {t.fromAddress && (
                <div className="text-sm">
                    <span className="text-[var(--hint)]">From: </span>
                    <Onchain value={t.fromAddress} chainId={chainId} />
                </div>
            )}
            {candidates.length === 0 ? (
                <Warn>
                    No open intent for this vault. Check the user's deposits or
                    reach out to them.
                </Warn>
            ) : (
                <div className="flex flex-wrap gap-2">
                    <Select
                        aria-label="Match to intent"
                        value={pick}
                        onChange={(e) => setPick(e.target.value)}
                        className="min-w-0 flex-1"
                    >
                        <option value="">Match to intent…</option>
                        {candidates.map((c) => (
                            <option key={c.intent.id} value={c.intent.id}>
                                {c.username ? `@${c.username}` : c.telegramId} ·{" "}
                                {formatUnits(
                                    c.intent.intendedAmount,
                                    c.decimals,
                                    2,
                                )}{" "}
                                {c.symbol}
                            </option>
                        ))}
                    </Select>
                    <Button
                        disabled={!pick || match.isPending}
                        onClick={() => match.mutate()}
                    >
                        Match
                    </Button>
                </div>
            )}
            <ErrorText error={match.error} />
        </Card>
    );
}

function Ingest({
    chains,
    onDone,
}: {
    chains: AdminChain[];
    onDone: () => void;
}) {
    const [chainId, setChainId] = useState("");
    const [hash, setHash] = useState("");
    const go = useAction({
        mutationFn: (_, key) =>
            api<{ transfers: unknown[] }>("/admin/transfers", {
                method: "POST",
                key,
                body: {
                    chainId: chainId || chains[0]?.id,
                    txHash: hash.trim(),
                },
            }),
        onSuccess: () => {
            setHash("");
            onDone();
        },
    });
    return (
        <Card className="space-y-3">
            <h3 className="display text-[17px] font-semibold">
                Add a transfer by transaction hash
            </h3>
            <Hint>
                Use it when the scanner missed a transfer. The server verifies
                it onchain before recording it.
            </Hint>
            <div className="flex flex-wrap gap-2">
                <Select
                    aria-label="Chain"
                    value={chainId || chains[0]?.id || ""}
                    onChange={(e) => setChainId(e.target.value)}
                >
                    {chains.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </Select>
                <Input
                    aria-label="Transaction hash"
                    placeholder="0x…"
                    value={hash}
                    onChange={(e) => setHash(e.target.value)}
                    className="min-w-0 flex-1 font-mono"
                />
                <Button
                    disabled={
                        !/^0x[a-fA-F0-9]{64}$/.test(hash.trim()) ||
                        chains.length === 0 ||
                        go.isPending
                    }
                    onClick={() => go.mutate()}
                >
                    Add
                </Button>
            </div>
            {go.data && (
                <p className="text-sm text-[var(--good)]">
                    Recorded {go.data.transfers.length} transfer(s).
                </p>
            )}
            <ErrorText error={go.error} />
        </Card>
    );
}
