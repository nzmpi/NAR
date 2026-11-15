import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, loginUrl } from "./lib/api";
import { Button, Hint } from "./components/ui";
import { Overview } from "./screens/Overview";
import { Settlement } from "./screens/Settlement";
import { Withdrawals } from "./screens/Withdrawals";

const TABS = [
    { id: "overview", label: "Overview" },
    { id: "withdrawals", label: "Withdrawals" },
    { id: "settlement", label: "Settlement" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function App() {
    const qc = useQueryClient();
    const [tab, setTab] = useState<Tab>("overview");
    const me = useQuery({
        queryKey: ["admin-me"],
        queryFn: () => api<{ id: string; telegramId: string }>("/admin/me"),
        retry: false,
    });
    const logout = useMutation({
        mutationFn: () => api("/admin/auth/logout", { method: "POST" }),
        onSuccess: () => qc.clear(),
    });

    if (me.isLoading)
        return (
            <div className="p-8">
                <Hint>Loading…</Hint>
            </div>
        );
    if (me.error) {
        const unauth =
            me.error instanceof ApiError &&
            (me.error.status === 401 || me.error.status === 403);
        return (
            <div className="mx-auto mt-24 max-w-sm space-y-4 p-6 text-center">
                <h1 className="text-xl font-semibold">NAR Admin</h1>
                {unauth ? (
                    <a href={loginUrl}>
                        <Button className="w-full">
                            Sign in with Telegram
                        </Button>
                    </a>
                ) : (
                    <p className="text-sm text-[var(--bad)]">
                        Cannot reach the API.
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-5xl p-4">
            <header className="mb-4 flex items-center justify-between border-b border-[var(--line)] pb-3">
                <nav className="flex gap-1">
                    {TABS.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className={`rounded-lg px-3 py-2 text-sm ${tab === t.id ? "bg-[var(--btn)] text-[var(--btn-fg)]" : "text-[var(--hint)]"}`}
                        >
                            {t.label}
                        </button>
                    ))}
                </nav>
                <Button variant="ghost" onClick={() => logout.mutate()}>
                    Sign out
                </Button>
            </header>
            {tab === "overview" && <Overview />}
            {tab === "withdrawals" && <Withdrawals />}
            {tab === "settlement" && <Settlement />}
        </div>
    );
}
