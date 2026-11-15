import type { ButtonHTMLAttributes, ReactNode } from "react";

export const Card = ({
    children,
    className = "",
}: {
    children: ReactNode;
    className?: string;
}) => (
    <div className={`rounded-2xl p-4 bg-[var(--bg2)] ${className}`}>
        {children}
    </div>
);

export const Hint = ({ children }: { children: ReactNode }) => (
    <p className="text-sm text-[var(--hint)]">{children}</p>
);

export function Button({
    variant = "primary",
    className = "",
    ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "ghost" | "danger";
}) {
    const v = {
        primary: "bg-[var(--btn)] text-[var(--btn-fg)]",
        ghost: "bg-transparent text-[var(--link)] border border-[var(--hint)]/40",
        danger: "bg-transparent text-[var(--bad)] border border-[var(--bad)]/50",
    }[variant];
    return (
        <button
            {...p}
            className={`rounded-xl px-4 py-3 font-medium disabled:opacity-50 active:opacity-80 ${v} ${className}`}
        />
    );
}

export const ErrorText = ({ error }: { error: unknown }) =>
    error ? (
        <p className="text-sm text-[var(--bad)]">
            {error instanceof Error ? error.message : "Error"}
        </p>
    ) : null;

const STATUS: Record<string, [string, string]> = {
    intent: ["Waiting for transfer", "var(--hint)"],
    transfer_detected: ["Transfer detected", "var(--warn)"],
    awaiting_user_approval: ["Needs your approval", "var(--warn)"],
    ready_to_activate: ["Confirmed, activating", "var(--warn)"],
    swept_and_confirmed: ["Active", "var(--good)"],
    rejected: ["Rejected", "var(--bad)"],
    expired: ["Expired", "var(--hint)"],
    cancelled: ["Cancelled", "var(--hint)"],
    pending: ["Pending review", "var(--warn)"],
    paid: ["Paid", "var(--good)"],
    applied: ["Applied", "var(--good)"],
    failed: ["Failed", "var(--bad)"],
};
export const StatusBadge = ({ status }: { status: string }) => {
    const [label, color] = STATUS[status] ?? [status, "var(--hint)"];
    return (
        <span
            className="text-xs rounded-full px-2 py-0.5"
            style={{ color, border: `1px solid ${color}` }}
        >
            {label}
        </span>
    );
};
