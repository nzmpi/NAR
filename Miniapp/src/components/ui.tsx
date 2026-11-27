import { useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import type {
    ButtonHTMLAttributes,
    InputHTMLAttributes,
    ReactNode,
    SelectHTMLAttributes,
} from "react";

export const Card = ({
    children,
    className = "",
}: {
    children: ReactNode;
    className?: string;
}) => (
    <div
        className={`rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-4 ${className}`}
    >
        {children}
    </div>
);

export const Hint = ({ children }: { children: ReactNode }) => (
    <p className="text-sm text-[var(--hint)]">{children}</p>
);

// Gradient header that opens every screen. Bleeds to the screen edges.
export const Header = ({
    title,
    children,
}: {
    title?: ReactNode;
    children?: ReactNode;
}) => (
    <header className="hero -mx-4 -mt-4 mb-1 flex flex-col gap-2 rounded-b-[28px] px-5 pt-[22px] pb-5 text-white">
        {title && <h1 className="display text-[26px] font-bold">{title}</h1>}
        {children}
    </header>
);

export function Button({
    variant = "primary",
    size = "md",
    className = "",
    ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "ghost" | "danger";
    size?: "md" | "lg";
}) {
    const v = {
        primary:
            "hero text-white font-bold shadow-[0_8px_20px_rgb(47_91_234/0.25)] disabled:bg-none disabled:bg-[var(--muted-soft)] disabled:text-[var(--hint)] disabled:shadow-none",
        ghost: "border border-[color-mix(in_srgb,var(--hint)_50%,transparent)] bg-[var(--card)] font-semibold",
        danger: "border border-[var(--bad)] text-[var(--bad)] font-semibold",
    }[variant];
    const s = size === "lg" ? "h-14 px-5 text-base" : "h-11 px-5 text-sm";
    return (
        <button
            {...p}
            className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-full active:opacity-80 disabled:cursor-not-allowed disabled:opacity-60 ${s} ${v} ${className}`}
        />
    );
}

const field =
    "h-12 rounded-[12px] border border-[var(--line)] bg-[var(--field)] px-4 text-[15px]";
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => (
    <input {...p} className={`w-full ${field} ${p.className ?? ""}`} />
);
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select
        {...p}
        className={`sel w-full cursor-pointer !rounded-full pr-11 font-medium ${field} ${p.className ?? ""}`}
    />
);
export const Field = ({
    label,
    children,
}: {
    label: ReactNode;
    children: ReactNode;
}) => (
    <label className="flex flex-col gap-1.5">
        <span className="text-[13px] text-[var(--hint)]">{label}</span>
        {children}
    </label>
);

// Small pill button for quick picks (25%, Max, …).
export const Chip = ({
    on,
    className = "",
    ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean }) => (
    <button
        {...p}
        aria-pressed={on}
        className={`h-8 cursor-pointer rounded-full border px-3 text-xs font-semibold ${on ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] bg-[var(--card)] text-[var(--soft)]"} ${className}`}
    />
);

// Pill tab group. `onHero` styles it for the gradient header.
export function Segmented<T extends string>({
    options,
    value,
    onChange,
    label,
    onHero = false,
    className = "",
}: {
    options: readonly { id: T; label: string }[];
    value: T;
    onChange: (v: T) => void;
    label: string;
    onHero?: boolean;
    className?: string;
}) {
    return (
        <div
            role="group"
            aria-label={label}
            className={`flex gap-0.5 rounded-full p-[3px] ${onHero ? "bg-white/15" : "bg-[var(--seg)]"} ${className}`}
        >
            {options.map((o) => {
                const on = o.id === value;
                return (
                    <button
                        key={o.id}
                        aria-pressed={on}
                        onClick={() => onChange(o.id)}
                        className={`h-[30px] flex-1 cursor-pointer rounded-full px-2 text-xs ${
                            onHero
                                ? on
                                    ? "bg-white/30 font-bold text-white"
                                    : "font-medium text-white/85"
                                : on
                                  ? "bg-[var(--seg-on)] font-bold text-[var(--fg)] shadow-sm"
                                  : "font-medium text-[var(--soft)]"
                        }`}
                    >
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

// Placeholder shapes shown while a screen's data loads.
const Bar = ({ className }: { className: string }) => (
    <span className={`block rounded-full bg-[var(--track)] ${className}`} />
);
export const Skeleton = ({ header = true }: { header?: boolean }) => (
    <div
        role="status"
        aria-label="Loading"
        className="flex animate-pulse flex-col gap-3"
    >
        {header && (
            <div className="hero -mx-4 -mt-4 mb-1 flex flex-col gap-3 rounded-b-[28px] px-5 pt-6 pb-5">
                <span className="block h-3 w-24 rounded-full bg-white/30" />
                <span className="block h-10 w-48 rounded-full bg-white/30" />
                <span className="block h-[30px] rounded-full bg-white/20" />
            </div>
        )}
        {[0, 1, 2].map((i) => (
            <Card key={i} className="flex flex-col gap-2.5">
                <Bar className="h-3.5 w-1/3" />
                <Bar className="h-6 w-1/2" />
                <Bar className="h-3 w-2/3" />
            </Card>
        ))}
    </div>
);

export function ErrorText({ error }: { error: unknown }) {
    // The demo note is a hint, not a failure: muted, and gone after 5 s.
    const isDemo = error instanceof ApiError && error.code === "demo";
    const [gone, setGone] = useState<unknown>(null);
    useEffect(() => {
        if (!isDemo) return;
        const t = setTimeout(() => setGone(error), 5000);
        return () => clearTimeout(t);
    }, [error, isDemo]);
    if (!error || gone === error) return null;
    return (
        <p
            role="alert"
            className={`text-sm ${isDemo ? "text-[var(--hint)]" : "text-[var(--bad)]"}`}
        >
            {error instanceof Error ? error.message : "Error"}
        </p>
    );
}

type Tone = "good" | "bad" | "warn" | "muted";
const STATUS: Record<string, [string, Tone]> = {
    intent: ["Waiting for transfer", "muted"],
    transfer_detected: ["Transfer detected", "warn"],
    awaiting_user_approval: ["Needs your approval", "warn"],
    ready_to_activate: ["Confirmed, activating", "warn"],
    swept_and_confirmed: ["Active", "good"],
    rejected: ["Rejected", "bad"],
    expired: ["Expired", "muted"],
    cancelled: ["Cancelled", "muted"],
    pending: ["Pending review", "warn"],
    awaiting_user: ["Needs your OK", "warn"],
    paid: ["Paid", "good"],
    applied: ["Applied", "good"],
    failed: ["Failed", "bad"],
    none: ["Not requested", "muted"],
    blocked: ["Blocked", "bad"],
};
const TONE: Record<Tone, string> = {
    good: "bg-[var(--good-soft)] text-[var(--good)]",
    bad: "bg-[var(--bad-soft)] text-[var(--bad)]",
    warn: "bg-[var(--warn-soft)] text-[var(--warn)]",
    muted: "bg-[var(--muted-soft)] text-[var(--soft)]",
};
export const statusOf = (status: string) =>
    STATUS[status] ?? [status, "muted" as Tone];
export const StatusBadge = ({ status }: { status: string }) => {
    const [label, tone] = statusOf(status);
    return (
        <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE[tone]}`}
        >
            {label}
        </span>
    );
};

// Tier colors (CSS variables) shared by every screen.
export const TIER_COLOR: Record<string, string> = {
    liquid: "var(--t0)",
    lock_1m: "var(--t1)",
    lock_2m: "var(--t2)",
    lock_3m: "var(--t3)",
    manager: "var(--mgr)",
};
export const TIER_SHORT: Record<string, string> = {
    liquid: "LQ",
    lock_1m: "1M",
    lock_2m: "2M",
    lock_3m: "3M",
};
