import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, getInitData } from "./lib/api";
import { ErrorText, Hint } from "./components/ui";
import { Home } from "./screens/Home";
import { Deposit } from "./screens/Deposit";
import { Withdraw } from "./screens/Withdraw";
import { Relock } from "./screens/Relock";
import { History } from "./screens/History";

const TABS = [
    { id: "home", label: "Home" },
    { id: "deposit", label: "Deposit" },
    { id: "withdraw", label: "Withdraw" },
    { id: "relock", label: "Relock" },
    { id: "history", label: "History" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function App() {
    const [tab, setTab] = useState<Tab>("home");
    const me = useQuery({
        queryKey: ["me"],
        queryFn: () => api<{ id: string }>("/me"),
        enabled: !!getInitData(),
        retry: false,
    });

    if (!getInitData())
        return (
            <div className="p-6">
                <Hint>Open this app from Telegram.</Hint>
            </div>
        );
    if (me.isLoading)
        return (
            <div className="p-6">
                <Hint>Loading…</Hint>
            </div>
        );
    if (me.error)
        return (
            <div className="p-6">
                <ErrorText error={me.error} />
            </div>
        );

    return (
        <div className="max-w-xl mx-auto px-4 pt-4 pb-24">
            {tab === "home" && <Home />}
            {tab === "deposit" && <Deposit />}
            {tab === "withdraw" && <Withdraw />}
            {tab === "relock" && <Relock />}
            {tab === "history" && <History />}
            <nav className="fixed bottom-0 inset-x-0 bg-[var(--bg)] border-t border-[var(--hint)]/30 pb-[env(safe-area-inset-bottom)]">
                <div className="max-w-xl mx-auto flex">
                    {TABS.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className={`flex-1 py-3 text-sm ${tab === t.id ? "text-[var(--btn)] font-medium" : "text-[var(--hint)]"}`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            </nav>
        </div>
    );
}
