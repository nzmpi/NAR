import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
const BASE =
    (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
    "";

export class ApiError extends Error {
    constructor(
        public status: number,
        public code: string,
        message: string,
    ) {
        super(message);
    }
}

export const loginUrl = `${BASE}/admin/auth/login`;

// Session is an httpOnly cookie. State-changing calls need the custom header (CSRF).
export async function api<T>(
    path: string,
    opts: { method?: "GET" | "POST"; body?: unknown; key?: string } = {},
): Promise<T> {
    const method = opts.method ?? "GET";
    const headers: Record<string, string> = {};
    if (method !== "GET") headers["X-Requested-With"] = "nar-admin";
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.key) headers["Idempotency-Key"] = opts.key;

    let res: Response;
    try {
        res = await fetch(BASE + path, {
            method,
            headers,
            credentials: "include",
            body:
                opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        });
    } catch {
        throw new ApiError(0, "network", "Network error");
    }
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const d = data as { error?: string; code?: string };
        throw new ApiError(
            res.status,
            d.code ?? "error",
            d.error ?? "Request failed",
        );
    }
    return data as T;
}

// useMutation for state-changing admin calls. One Idempotency-Key per action
// until it succeeds, so a double-click or retry cannot act twice.
export function useAction<T, V = void>(o: {
    mutationFn: (v: V, key: string) => Promise<T>;
    onSuccess?: (r: T, v: V) => unknown;
}) {
    const key = useRef(crypto.randomUUID());
    // A second click before the first returns joins it instead of getting 409 in_progress.
    const inflight = useRef<Promise<T> | undefined>(undefined);
    return useMutation({
        mutationFn: (v: V) =>
            (inflight.current ??= o
                .mutationFn(v, key.current)
                .finally(() => (inflight.current = undefined))),
        onSuccess: (r, v) => {
            key.current = crypto.randomUUID();
            return o.onSuccess?.(r, v);
        },
    });
}
