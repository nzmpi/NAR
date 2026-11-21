import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, useAction } from "../lib/api";
import type { AdminAsset, AdminChain } from "../lib/types";
import {
    Badge,
    Button,
    ErrorText,
    Field,
    Hint,
    Input,
    Mono,
    Panel,
    Select,
    TD,
    TH,
    Warn,
} from "../components/ui";

const Foot = ({ children }: { children: React.ReactNode }) => (
    <div className="space-y-2.5 border-t border-[var(--line)] bg-[var(--bg)] px-5 py-4">
        {children}
    </div>
);

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
        <div className="flex flex-col gap-5">
            <Hint>
                Chains and tokens users can deposit. Changes here affect every
                new deposit.
            </Hint>
            <ErrorText error={chains.error || assets.error} />
            <div className="flex flex-wrap items-start gap-4">
                <Panel title="Chains" className="min-w-0 flex-[1_1_340px]">
                    {chains.data?.map((c, i) => (
                        <div
                            key={c.id}
                            className={`flex items-center gap-3 px-5 py-3.5 ${i ? "border-t border-[var(--row)]" : ""}`}
                        >
                            <div className="flex-1">
                                <div className="font-semibold">{c.name}</div>
                                <div className="text-xs text-[var(--hint)]">
                                    chain id {c.chainId}
                                </div>
                            </div>
                            <Badge
                                status={c.isActive ? "active" : "inactive"}
                            />
                        </div>
                    ))}
                    {chains.data?.length === 0 && (
                        <div className="px-5 py-4">
                            <Hint>No chains yet.</Hint>
                        </div>
                    )}
                    <AddChain onDone={refresh} />
                </Panel>

                <Panel title="Assets" className="min-w-0 flex-[2_1_480px]">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[520px] border-collapse">
                            <thead>
                                <tr>
                                    <th className={TH}>Token</th>
                                    <th className={TH}>Contract</th>
                                    <th className={`${TH} text-right`}>
                                        Decimals
                                    </th>
                                    <th className={TH}>Status</th>
                                    <th className={TH}>
                                        <span className="sr-only">Actions</span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {assets.data?.map((a) => (
                                    <AssetRow
                                        key={a.id}
                                        a={a}
                                        onDone={refresh}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {assets.data?.length === 0 && (
                        <div className="px-5 py-4">
                            <Hint>No assets yet.</Hint>
                        </div>
                    )}
                    <AddAsset chains={chains.data ?? []} onDone={refresh} />
                </Panel>
            </div>
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
        <Foot>
            <h3 className="text-sm font-semibold">Add chain</h3>
            <div className="flex flex-wrap items-end gap-2">
                <Field label="Name" className="flex-[2_1_160px]">
                    <Input
                        placeholder="Polygon"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </Field>
                <Field label="Chain ID" className="flex-[1_1_100px]">
                    <Input
                        placeholder="137"
                        inputMode="numeric"
                        value={id}
                        onChange={(e) =>
                            setId(e.target.value.replace(/\D/g, ""))
                        }
                    />
                </Field>
                <Button
                    disabled={!name.trim() || !id || go.isPending}
                    onClick={() => go.mutate()}
                >
                    Add chain
                </Button>
            </div>
            <p className="text-xs text-[var(--hint)]">
                After adding a chain: set RPC_URL_&lt;chainId&gt; in the API
                environment and restart it. The Factory and Vault bytecode must
                be the same as on the other chains, or vault addresses will
                differ.
            </p>
            <ErrorText error={go.error} />
        </Foot>
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
        <tr className="border-t border-[var(--row)] align-top">
            <td className={TD}>
                <div className="font-semibold">{a.symbol}</div>
                <div className="text-xs text-[var(--hint)]">{a.chainName}</div>
            </td>
            <td className={`${TD} text-[var(--soft)]`}>
                <span title={a.tokenAddress}>
                    <Mono>
                        {a.tokenAddress.slice(0, 6)}…{a.tokenAddress.slice(-4)}
                    </Mono>
                </span>
            </td>
            <td className={`${TD} text-right tnum`}>{a.decimals}</td>
            <td className={TD}>
                <Badge status={a.isActive ? "active" : "inactive"} />
            </td>
            <td className={`${TD} text-right`}>
                <Button
                    size="sm"
                    variant="ghost"
                    disabled={go.isPending}
                    onClick={() => go.mutate()}
                >
                    {a.isActive ? "Disable" : "Enable"}
                </Button>
                <ErrorText error={go.error} />
            </td>
        </tr>
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
    return (
        <Foot>
            <h3 className="text-sm font-semibold">Add asset</h3>
            <div className="flex flex-wrap items-end gap-2">
                <Field label="Chain" className="flex-[1_1_140px]">
                    <Select
                        value={chain || chains[0]?.id || ""}
                        onChange={(e) => setChain(e.target.value)}
                    >
                        {chains.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field label="Symbol" className="flex-[1_1_100px]">
                    <Select
                        value={symbol}
                        onChange={(e) =>
                            setSymbol(e.target.value as typeof symbol)
                        }
                    >
                        {["USDT", "USDC", "DAI"].map((s) => (
                            <option key={s}>{s}</option>
                        ))}
                    </Select>
                </Field>
                <Field
                    label="Token contract"
                    className="min-w-0 flex-[3_1_220px]"
                >
                    <Input
                        placeholder="0x…"
                        value={addr}
                        onChange={(e) => setAddr(e.target.value)}
                        className="font-mono"
                    />
                </Field>
                <Field label="Decimals" className="flex-[1_1_90px]">
                    <Input
                        placeholder="6"
                        inputMode="numeric"
                        value={dec}
                        onChange={(e) =>
                            setDec(e.target.value.replace(/\D/g, ""))
                        }
                    />
                </Field>
                <Button
                    disabled={
                        !/^0x[a-fA-F0-9]{40}$/.test(addr.trim()) ||
                        !dec ||
                        chains.length === 0 ||
                        go.isPending
                    }
                    onClick={() => go.mutate()}
                >
                    Add asset
                </Button>
            </div>
            <Warn>
                Check the decimals on the explorer: USDT and USDC are 6 on most
                chains but 18 on BNB Chain. A wrong value misprices deposits.
            </Warn>
            <ErrorText error={go.error} />
        </Foot>
    );
}
