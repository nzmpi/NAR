import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, getInitData, setDemo } from "./lib/api";
import type { AccessStatus } from "./lib/types";
import { ErrorText, Hint, Skeleton } from "./components/ui";
import { Home } from "./screens/Home";
import { Deposit } from "./screens/Deposit";
import { Withdraw } from "./screens/Withdraw";
import { Relock } from "./screens/Relock";
import { History } from "./screens/History";

const TABS = [
    { id: "home", label: "Home", icon: "M4 11l8-7 8 7v9h-5v-6H9v6H4z" },
    { id: "deposit", label: "Deposit", icon: "M12 4v12M6 10l6 6 6-6M4 20h16" },
    {
        id: "withdraw",
        label: "Withdraw",
        icon: "M12 20V8M6 14l6-6 6 6M4 4h16",
    },
    {
        id: "relock",
        label: "Relock",
        icon: "M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M18 3v4h-4M6 21v-4h4",
    },
    {
        id: "history",
        label: "History",
        icon: "M12 7v5l3 2M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4h4",
    },
] as const;
export type Tab = (typeof TABS)[number]["id"];

// Follow Telegram's theme; outside Telegram (no initData), follow the OS.
function useDarkTheme() {
    useEffect(() => {
        const tg = window.Telegram?.WebApp;
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const apply = () =>
            document.documentElement.classList.toggle(
                "dark",
                tg?.initData ? tg.colorScheme === "dark" : mq.matches,
            );
        apply();
        tg?.onEvent?.("themeChanged", apply);
        mq.addEventListener("change", apply);
        return () => {
            tg?.offEvent?.("themeChanged", apply);
            mq.removeEventListener("change", apply);
        };
    }, []);
}

export default function App() {
    useDarkTheme();
    const [tab, setTab] = useState<Tab>("home");
    const access = useQuery({
        queryKey: ["access"],
        queryFn: () => api<AccessStatus>("/me/access"),
        enabled: !!getInitData(),
        retry: false,
        // Notice an approval while the app is open.
        refetchInterval: (q) =>
            q.state.data?.status === "pending" ? 10 * 60_000 : false,
    });
    const demo = access.data ? access.data.status !== "approved" : undefined;
    // Set before any screen mounts, so every request sees the right mode.
    if (demo !== undefined) setDemo(demo);
    // Demo data is cached under the real query keys: start clean once approved.
    const wasDemo = useRef(demo);
    useEffect(() => {
        if (wasDemo.current && demo === false) window.location.reload();
        wasDemo.current = demo;
    }, [demo]);
    const me = useQuery({
        queryKey: ["me"],
        queryFn: () => api<{ id: string; isAdmin?: boolean }>("/me"),
        enabled: demo !== undefined,
        retry: false,
    });
    const go = (t: Tab) => {
        setTab(t);
        window.scrollTo(0, 0);
    };

    if (!getInitData())
        return (
            <div className="p-6">
                <Hint>Open this app from Telegram.</Hint>
            </div>
        );
    if (access.error || me.error)
        return (
            <div className="p-6">
                <ErrorText error={access.error || me.error} />
            </div>
        );
    if (access.isPending || me.isPending)
        return (
            <div className="mx-auto max-w-xl px-4 pt-4">
                <Skeleton />
            </div>
        );

    return (
        <div className="tnum mx-auto max-w-xl px-4 pt-4 pb-28">
            {tab === "home" && (
                <Home go={go} access={demo ? access.data : undefined} />
            )}
            {tab === "deposit" && <Deposit />}
            {tab === "withdraw" && <Withdraw />}
            {tab === "relock" && <Relock />}
            {tab === "history" && <History />}
            <nav
                aria-label="Main"
                className="fixed inset-x-0 bottom-0 border-t border-[var(--line)] bg-[var(--nav)] pb-[env(safe-area-inset-bottom)]"
            >
                <div className="mx-auto flex max-w-xl px-1.5 pt-1.5 pb-3">
                    {TABS.map((t) => {
                        const on = tab === t.id;
                        return (
                            <button
                                key={t.id}
                                aria-current={on ? "page" : undefined}
                                onClick={() => go(t.id)}
                                className={`flex min-h-[52px] flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 text-[11px] ${on ? "font-semibold text-[var(--accent-ink)]" : "font-medium text-[var(--hint)]"}`}
                            >
                                <span
                                    className={`flex h-7 w-[52px] items-center justify-center rounded-full ${on ? "bg-[var(--accent-soft)]" : ""}`}
                                >
                                    <svg
                                        width="22"
                                        height="22"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        aria-hidden="true"
                                    >
                                        <path d={t.icon} />
                                    </svg>
                                </span>
                                {t.label}
                            </button>
                        );
                    })}
                </div>
            </nav>
        </div>
    );
}
