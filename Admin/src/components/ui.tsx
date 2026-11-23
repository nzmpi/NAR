import { Component } from "react";
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
        className={`rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 ${className}`}
    >
        {children}
    </div>
);
// Card with a header row and edge-to-edge body (tables, lists).
export const Panel = ({
    title,
    right,
    children,
    className = "",
}: {
    title?: ReactNode;
    right?: ReactNode;
    children: ReactNode;
    className?: string;
}) => (
    <section
        className={`overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] ${className}`}
    >
        {(title || right) && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
                {title && (
                    <h2 className="display text-[17px] font-semibold">
                        {title}
                    </h2>
                )}
                {right}
            </div>
        )}
        {children}
    </section>
);
// Inline form area inside a card.
export const Sub = ({
    children,
    className = "",
}: {
    children: ReactNode;
    className?: string;
}) => (
    <div
        className={`space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4 ${className}`}
    >
        {children}
    </div>
);
export const Hint = ({ children }: { children: ReactNode }) => (
    <p className="text-sm text-[var(--hint)]">{children}</p>
);
export const Warn = ({ children }: { children: ReactNode }) => (
    <p className="rounded-xl bg-[var(--warn-soft)] px-3 py-2.5 text-sm font-medium text-[var(--warn)]">
        {children}
    </p>
);

export function Button({
    variant = "primary",
    size = "md",
    className = "",
    ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "ghost" | "danger";
    size?: "sm" | "md";
}) {
    const v = {
        primary: "bg-[var(--btn)] text-[var(--btn-fg)] font-semibold",
        ghost: "border border-[var(--line)] bg-[var(--card)] font-medium hover:bg-[var(--hover)]",
        danger: "border border-[var(--bad)] text-[var(--bad)] font-semibold hover:bg-[var(--bad-soft)]",
    }[variant];
    const s =
        size === "sm" ? "h-8 px-3.5 text-[13px]" : "h-10 px-4 text-[13px]";
    return (
        <button
            {...p}
            className={`inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full disabled:cursor-not-allowed disabled:opacity-50 ${s} ${v} ${className}`}
        />
    );
}
const field =
    "h-10 rounded-[10px] border border-[var(--line)] bg-[var(--field)] px-3 text-sm";
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => (
    <input {...p} className={`w-full ${field} ${p.className ?? ""}`} />
);
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select
        {...p}
        className={`sel h-10 cursor-pointer rounded-full border border-[var(--line)] bg-[var(--field)] pr-9 pl-4 text-sm ${p.className ?? ""}`}
    />
);
export const Field = ({
    label,
    children,
    className = "",
}: {
    label: ReactNode;
    children: ReactNode;
    className?: string;
}) => (
    <label className={`flex flex-col gap-1.5 text-sm ${className}`}>
        <span className="text-xs text-[var(--hint)]">{label}</span>
        {children}
    </label>
);
export const ErrorText = ({ error }: { error: unknown }) =>
    error ? (
        <p role="alert" className="text-sm text-[var(--bad)]">
            {error instanceof Error ? error.message : "Error"}
        </p>
    ) : null;

const TONE = {
    good: "bg-[var(--good-soft)] text-[var(--good)]",
    bad: "bg-[var(--bad-soft)] text-[var(--bad)]",
    warn: "bg-[var(--warn-soft)] text-[var(--warn)]",
    accent: "bg-[var(--accent-soft)] text-[var(--accent-ink)]",
    muted: "bg-[var(--muted-soft)] text-[var(--soft)]",
};
export type Tone = keyof typeof TONE;
const STATUS_TONE: Record<string, Tone> = {
    pending: "warn",
    intent: "muted",
    transfer_detected: "warn",
    awaiting_user_approval: "accent",
    ready_to_activate: "warn",
    swept_and_confirmed: "good",
    paid: "good",
    active: "good",
    deployed: "good",
    applied: "good",
    rejected: "bad",
    failed: "bad",
    blocked: "bad",
};
export const Pill = ({
    tone,
    children,
}: {
    tone: Tone;
    children: ReactNode;
}) => (
    <span
        className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]}`}
    >
        {children}
    </span>
);
export const Badge = ({ status }: { status: string }) => {
    const label = status.replaceAll("_", " ");
    return (
        <Pill tone={STATUS_TONE[status] ?? "muted"}>
            {label[0].toUpperCase() + label.slice(1)}
        </Pill>
    );
};
export const Mono = ({ children }: { children: ReactNode }) => (
    <span className="font-mono text-xs break-all">{children}</span>
);

// Pill-shaped tab group. Counts show next to the label.
export function Segmented<T extends string>({
    options,
    value,
    onChange,
    label,
}: {
    options: readonly { id: T; label: string; count?: number }[];
    value: T;
    onChange: (v: T) => void;
    label: string;
}) {
    return (
        <div
            role="group"
            aria-label={label}
            className="inline-flex flex-wrap gap-0.5 rounded-full bg-[var(--seg)] p-[3px]"
        >
            {options.map((o) => {
                const on = o.id === value;
                return (
                    <button
                        key={o.id}
                        aria-pressed={on}
                        onClick={() => onChange(o.id)}
                        className={`h-8 cursor-pointer rounded-full px-3.5 text-[13px] ${on ? "bg-[var(--seg-on)] font-semibold text-[var(--fg)] shadow-sm" : "font-medium text-[var(--soft)]"}`}
                    >
                        {o.label}
                        {o.count !== undefined && (
                            <span className="ml-1.5 tnum opacity-70">
                                {o.count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

export const TH =
    "px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-[var(--hint)] first:pl-5 last:pr-5";
export const TD = "px-3 py-3 first:pl-5 last:pr-5";

export const signedUsd = (v: bigint, fmt: (x: bigint) => string) =>
    `${v > 0n ? "+" : v < 0n ? "−" : ""}$${fmt(v < 0n ? -v : v)}`;
export const toneOf = (v: bigint) =>
    v > 0n ? "var(--good)" : v < 0n ? "var(--bad)" : undefined;

// Shows the error instead of a blank page when a screen crashes.
export class ErrorBoundary extends Component<
    { children: ReactNode },
    { error: Error | null }
> {
    state = { error: null as Error | null };
    static getDerivedStateFromError(error: Error) {
        return { error };
    }
    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div
                role="alert"
                className="space-y-2 rounded-2xl border border-[var(--line)] bg-[var(--bad-soft)] p-5 text-[var(--bad)]"
            >
                <p className="font-semibold">This page failed to load.</p>
                <p className="text-sm">{this.state.error.message}</p>
                <Button variant="ghost" onClick={() => location.reload()}>
                    Reload
                </Button>
            </div>
        );
    }
}

// Block explorers by EVM chain id. Unknown chains show plain text.
const EXPLORERS: Record<number, string> = {
    1: "https://etherscan.io",
    11155111: "https://sepolia.etherscan.io",
    56: "https://bscscan.com",
    97: "https://testnet.bscscan.com",
    8453: "https://basescan.org",
    84532: "https://sepolia.basescan.org",
    42161: "https://arbiscan.io",
    421614: "https://sepolia.arbiscan.io",
    10: "https://optimistic.etherscan.io",
    137: "https://polygonscan.com",
};

export function explorerUrl(value: string, chainId?: number) {
    const base = chainId === undefined ? undefined : EXPLORERS[chainId];
    if (!base) return null;
    const kind = /^0x[0-9a-fA-F]{64}$/.test(value) ? "tx" : "address";
    return `${base}/${kind}/${value}`;
}

// An address or tx hash, linked to its explorer page when the chain is known.
export function Onchain({
    value,
    chainId,
    short = false,
}: {
    value: string;
    chainId?: number;
    short?: boolean;
}) {
    const url = explorerUrl(value, chainId);
    const text = short ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
    if (!url)
        return (
            <span className="font-mono text-xs break-all" title={value}>
                {text}
            </span>
        );
    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open on explorer: ${value}`}
            className="font-mono text-xs break-all text-[var(--link)] hover:underline"
        >
            {text}
        </a>
    );
}

// Lists are newest-first and capped by the server; "Show more" asks for a larger page.
export const PAGE = 200;
export function ShowMore({
    count,
    limit,
    onMore,
}: {
    count: number;
    limit: number;
    onMore: () => void;
}) {
    if (count < limit) return null;
    return (
        <div className="flex justify-center">
            <Button variant="ghost" onClick={onMore}>
                Show more
            </Button>
        </div>
    );
}
