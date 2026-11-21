import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, loginUrl } from "./lib/api";
import type { AdminDeposit, AdminTransfer, AdminWithdrawal } from "./lib/types";
import { Hint } from "./components/ui";
import { Overview } from "./screens/Overview";
import { Settlement } from "./screens/Settlement";
import { Withdrawals } from "./screens/Withdrawals";
import { Settlements } from "./screens/Settlements";
import { Audit } from "./screens/Audit";
import { Deposits, NEEDS_ACTION } from "./screens/Deposits";
import { Transfers } from "./screens/Transfers";
import { Users } from "./screens/Users";
import { Setup } from "./screens/Setup";

const ICON = {
    overview: "M4 19V10M10 19V5M16 19v-6M22 19H2",
    audit: "M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01",
    deposits: "M12 4v12M6 10l6 6 6-6M4 20h16",
    transfers: "M4 8h14l-4-4M20 16H6l4 4",
    withdrawals: "M12 20V8M6 14l6-6 6 6M4 4h16",
    settlement: "M5 12l5 5L20 7",
    settlements: "M12 8v4l3 2M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4h4",
    users: "M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.7 3 2.5 3.5 5.2",
    setup: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1",
};
export type Tab = keyof typeof ICON;
const GROUPS: { label: string; items: [Tab, string][] }[] = [
    {
        label: "Monitor",
        items: [
            ["overview", "Overview"],
            ["settlement", "Run settlement"],
            ["audit", "Audit"],
            ["settlements", "Settlement history"],
        ],
    },
    {
        label: "Money",
        items: [
            ["deposits", "Deposits"],
            ["transfers", "Transfers"],
            ["withdrawals", "Withdrawals"],
        ],
    },
    {
        label: "People",
        items: [
            ["users", "Users"],
            ["setup", "Setup"],
        ],
    },
];
const TITLE = Object.fromEntries(GROUPS.flatMap((g) => g.items)) as Record<
    Tab,
    string
>;

// Work waiting on an admin. Same query keys as the screens, so the cache is shared.
export function useCounts() {
    const w = useQuery({
        queryKey: ["admin-withdrawals", "pending"],
        queryFn: () =>
            api<AdminWithdrawal[]>("/admin/withdrawals?status=pending"),
        refetchInterval: 30_000,
    });
    const d = useQuery({
        queryKey: ["admin-deposits"],
        queryFn: () => api<AdminDeposit[]>("/admin/deposits"),
        refetchInterval: 30_000,
    });
    const t = useQuery({
        queryKey: ["admin-transfers"],
        queryFn: () => api<AdminTransfer[]>("/admin/transfers?unmatched=true"),
        refetchInterval: 30_000,
    });
    return {
        withdrawals: w.data?.length ?? 0,
        deposits:
            d.data?.filter((x) => NEEDS_ACTION.includes(x.intent.status))
                .length ?? 0,
        transfers: t.data?.length ?? 0,
    };
}

const Logo = ({ size }: { size: number }) => (
    <div
        className="display flex items-center justify-center rounded-full bg-[var(--btn)] font-semibold text-white"
        style={{ width: size, height: size, fontSize: size * 0.46 }}
    >
        N
    </div>
);

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
            <div className="flex min-h-screen items-center justify-center px-4 py-6">
                <main className="flex w-full max-w-[400px] flex-col items-center gap-5 rounded-[20px] border border-[var(--line)] bg-[var(--card)] px-8 py-10 text-center">
                    <Logo size={48} />
                    <div>
                        <h1 className="display text-2xl font-semibold">
                            NAR Admin
                        </h1>
                        <p className="mt-1.5 text-[var(--hint)]">
                            Sign in with the Telegram account that has admin
                            access.
                        </p>
                    </div>
                    {unauth ? (
                        <a
                            href={loginUrl}
                            className="flex h-12 w-full items-center justify-center rounded-full bg-[var(--btn)] text-[15px] font-semibold text-[var(--btn-fg)]"
                        >
                            Sign in with Telegram
                        </a>
                    ) : (
                        <p
                            role="alert"
                            className="w-full rounded-xl bg-[var(--bad-soft)] px-3 py-2.5 font-medium text-[var(--bad)]"
                        >
                            Cannot reach the API.
                        </p>
                    )}
                </main>
            </div>
        );
    }

    return (
        <Shell
            tab={tab}
            setTab={setTab}
            me={me.data!}
            onLogout={() => logout.mutate()}
        />
    );
}

function Shell({
    tab,
    setTab,
    me,
    onLogout,
}: {
    tab: Tab;
    setTab: (t: Tab) => void;
    me: { telegramId: string };
    onLogout: () => void;
}) {
    const counts = useCounts();
    const badge: Partial<Record<Tab, number>> = counts;

    return (
        <div className="flex min-h-screen flex-col tnum md:flex-row">
            <aside className="flex shrink-0 flex-col gap-6 border-b border-[var(--line)] bg-[var(--nav)] px-3.5 py-5 md:w-[232px] md:border-r md:border-b-0">
                <div className="flex items-center gap-2.5 px-2.5">
                    <Logo size={32} />
                    <span className="display text-[17px] font-semibold">
                        NAR Admin
                    </span>
                </div>
                <nav
                    aria-label="Main"
                    className="flex flex-wrap gap-4 md:flex-col md:gap-[18px]"
                >
                    {GROUPS.map((g) => (
                        <div key={g.label} className="flex flex-col gap-0.5">
                            <div className="px-3 pb-1.5 text-[11px] font-semibold tracking-[0.06em] text-[var(--hint)] uppercase">
                                {g.label}
                            </div>
                            {g.items.map(([id, label]) => {
                                const on = id === tab;
                                const n = badge[id];
                                return (
                                    <button
                                        key={id}
                                        aria-current={on ? "page" : undefined}
                                        onClick={() => setTab(id)}
                                        className={`flex min-h-10 cursor-pointer items-center gap-2.5 rounded-full px-3 text-left ${on ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-ink)]" : "text-[var(--soft)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"}`}
                                    >
                                        <svg
                                            width="18"
                                            height="18"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            aria-hidden="true"
                                        >
                                            <path d={ICON[id]} />
                                        </svg>
                                        <span className="flex-1">{label}</span>
                                        {!!n && (
                                            <span className="min-w-5 rounded-full bg-[var(--warn-soft)] px-[7px] py-px text-center text-xs font-semibold text-[var(--warn)]">
                                                {n}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </nav>
            </aside>

            <main className="min-w-0 flex-1 px-4 pt-6 pb-12 sm:px-6 lg:px-10">
                <div className="mx-auto flex max-w-[1120px] flex-col gap-5">
                    <header className="flex flex-wrap items-center justify-between gap-3">
                        <h1 className="display text-[28px] font-semibold tracking-tight">
                            {TITLE[tab]}
                        </h1>
                        <div className="flex items-center gap-2.5">
                            <span className="text-[13px] text-[var(--hint)]">
                                Admin · tg {me.telegramId}
                            </span>
                            <button
                                onClick={onLogout}
                                className="h-9 cursor-pointer rounded-full border border-[var(--line)] bg-[var(--card)] px-4 text-[13px] font-medium hover:bg-[var(--hover)]"
                            >
                                Sign out
                            </button>
                        </div>
                    </header>
                    {tab === "overview" && (
                        <Overview counts={counts} go={setTab} />
                    )}
                    {tab === "users" && <Users />}
                    {tab === "setup" && <Setup />}
                    {tab === "deposits" && <Deposits />}
                    {tab === "transfers" && <Transfers />}
                    {tab === "withdrawals" && <Withdrawals />}
                    {tab === "settlement" && <Settlement go={setTab} />}
                    {tab === "settlements" && <Settlements />}
                    {tab === "audit" && <Audit />}
                </div>
            </main>
        </div>
    );
}
