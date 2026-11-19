import type { ButtonHTMLAttributes, ReactNode } from "react";

export const Card = ({
    children,
    className = "",
}: {
    children: ReactNode;
    className?: string;
}) => (
    <div
        className={`rounded-xl border border-[var(--line)] bg-[var(--bg2)] p-4 ${className}`}
    >
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
        ghost: "border border-[var(--line)]",
        danger: "border border-[var(--bad)] text-[var(--bad)]",
    }[variant];
    return (
        <button
            {...p}
            className={`rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${v} ${className}`}
        />
    );
}
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
        {...p}
        className={`w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm ${p.className ?? ""}`}
    />
);
export const ErrorText = ({ error }: { error: unknown }) =>
    error ? (
        <p className="text-sm text-[var(--bad)]">
            {error instanceof Error ? error.message : "Error"}
        </p>
    ) : null;

const COLORS: Record<string, string> = {
    pending: "var(--warn)",
    paid: "var(--good)",
    rejected: "var(--bad)",
    cancelled: "var(--hint)",
};
export const Badge = ({ status }: { status: string }) => {
    const c = COLORS[status] ?? "var(--hint)";
    return (
        <span
            className="rounded-full px-2 py-0.5 text-xs"
            style={{ color: c, border: `1px solid ${c}` }}
        >
            {status}
        </span>
    );
};
export const Mono = ({ children }: { children: ReactNode }) => (
    <span className="font-mono text-xs break-all">{children}</span>
);
