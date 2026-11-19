import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, useAction } from "../lib/api";
import type { AdminAsset, AdminChain } from "../lib/types";
import {
    Badge,
    Button,
    Card,
    ErrorText,
    Hint,
    Input,
    Mono,
} from "../components/ui";

export function Setup() {
    const qc = useQueryClient();
    const chains = useQuery({
        queryKey: ["admin-chains"],
        queryFn: () => api<AdminChain[]>("/admin/chains"),
    });
    const assets = useQuery({
        queryKey: ["admin-assets"],
        queryFn: () => api<AdminAsset[]>("/admin/assets"),
    });
    const refresh = () => {
        for (const k of ["admin-chains", "admin-assets"])
            qc.invalidateQueries({ queryKey: [k] });
    };

    return (
        <div className="space-y-6">
            <section className="space-y-3">
                <h2 className="font-medium">Chains</h2>
                <Card className="space-y-1 text-sm">
                    {chains.data?.map((c) => (
                        <div key={c.id} className="flex justify-between">
                            <span>
                                {c.name}{" "}
                                <span className="text-[var(--hint)]">
                                    · chain id {c.chainId}
                                </span>
                            </span>
                            <Badge
                                status={c.isActive ? "active" : "inactive"}
                            />
                        </div>
                    ))}
                    {chains.data?.length === 0 && <Hint>No chains yet.</Hint>}
                </Card>
                <AddChain onDone={refresh} />
            </section>

            <section className="space-y-3">
                <h2 className="font-medium">Assets</h2>
                <div className="space-y-2">
                    {assets.data?.map((a) => (
                        <AssetRow key={a.id} a={a} onDone={refresh} />
                    ))}
                    {assets.data?.length === 0 && <Hint>No assets yet.</Hint>}
                </div>
                <ErrorText error={chains.error || assets.error} />
                <AddAsset chains={chains.data ?? []} onDone={refresh} />
            </section>
        </div>
    );
}

function AddChain({ onDone }: { onDone: () => void }) {
    const [name, setName] = useState("");
    const [id, setId] = useState("");
    const go = useAction({
        mutationFn: (_, key) =>
            api("/admin/chains", {
                method: "POST",
                key,
                body: { name: name.trim(), chainId: Number(id) },
            }),
        onSuccess: () => {
            setName("");
            setId("");
            onDone();
        },
    });
    return (
        <Card className="space-y-2">
            <h3 className="text-sm font-medium">Add chain</h3>
            <div className="flex flex-wrap gap-2">
                <Input
                    placeholder="Name (e.g. Polygon)"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="flex-1"
                />
                <Input
                    placeholder="Chain ID (137)"
                    inputMode="numeric"
                    value={id}
                    onChange={(e) => setId(e.target.value.replace(/\D/g, ""))}
                    className="w-32"
                />
                <Button
                    disabled={!name.trim() || !id || go.isPending}
                    onClick={() => go.mutate()}
                >
                    Add
                </Button>
            </div>
            <Hint>
                After adding a chain: set RPC_URL_&lt;chainId&gt; in the API
                environment and restart it. The Factory and Vault bytecode must
                be the same as on the other chains, or vault addresses will
                differ.
            </Hint>
            <ErrorText error={go.error} />
        </Card>
    );
}

function AssetRow({ a, onDone }: { a: AdminAsset; onDone: () => void }) {
    const go = useAction({
        mutationFn: (_, key) =>
            api(`/admin/assets/${a.id}/active`, {
                method: "POST",
                key,
                body: { isActive: !a.isActive },
            }),
        onSuccess: onDone,
    });
    return (
        <Card className="space-y-1">
            <div className="flex items-center justify-between text-sm">
                <span>
                    <b>{a.symbol}</b> on {a.chainName}{" "}
                    <span className="text-[var(--hint)]">
                        · {a.decimals} decimals
                    </span>
                </span>
                <div className="flex items-center gap-2">
                    <Badge status={a.isActive ? "active" : "inactive"} />
                    <Button
                        variant="ghost"
                        disabled={go.isPending}
                        onClick={() => go.mutate()}
                    >
                        {a.isActive ? "Disable" : "Enable"}
                    </Button>
                </div>
            </div>
            <Mono>{a.tokenAddress}</Mono>
            <ErrorText error={go.error} />
        </Card>
    );
}

function AddAsset({
    chains,
    onDone,
}: {
    chains: AdminChain[];
    onDone: () => void;
}) {
    const [chain, setChain] = useState("");
    const [symbol, setSymbol] = useState<"USDT" | "USDC" | "DAI">("USDC");
    const [addr, setAddr] = useState("");
    const [dec, setDec] = useState("6");
    const go = useAction({
        mutationFn: (_, key) =>
            api("/admin/assets", {
                method: "POST",
                key,
                body: {
                    chainId: chain || chains[0]?.id,
                    symbol,
                    name: symbol,
                    tokenAddress: addr.trim(),
                    decimals: Number(dec),
                },
            }),
        onSuccess: () => {
            setAddr("");
            onDone();
        },
    });
    const sel =
        "rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm";
    return (
        <Card className="space-y-2">
            <h3 className="text-sm font-medium">Add asset</h3>
            <div className="flex flex-wrap gap-2">
                <select
                    value={chain || chains[0]?.id || ""}
                    onChange={(e) => setChain(e.target.value)}
                    className={sel}
                >
                    {chains.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </select>
                <select
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value as typeof symbol)}
                    className={sel}
                >
                    {["USDT", "USDC", "DAI"].map((s) => (
                        <option key={s}>{s}</option>
                    ))}
                </select>
                <Input
                    placeholder="Token contract 0x…"
                    value={addr}
                    onChange={(e) => setAddr(e.target.value)}
                    className="min-w-0 flex-1 font-mono"
                />
                <Input
                    placeholder="Decimals"
                    inputMode="numeric"
                    value={dec}
                    onChange={(e) => setDec(e.target.value.replace(/\D/g, ""))}
                    className="w-24"
                />
                <Button
                    disabled={
                        !/^0x[a-fA-F0-9]{40}$/.test(addr.trim()) ||
                        !dec ||
                        chains.length === 0 ||
                        go.isPending
                    }
                    onClick={() => go.mutate()}
                >
                    Add
                </Button>
            </div>
            <Hint>
                Check the decimals on the explorer: USDT and USDC are 6 on most
                chains but 18 on BNB Chain. A wrong value misprices deposits.
            </Hint>
            <ErrorText error={go.error} />
        </Card>
    );
}
