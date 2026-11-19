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
    opts: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
    const method = opts.method ?? "GET";
    const headers: Record<string, string> = {};
    if (method !== "GET") headers["X-Requested-With"] = "nar-admin";
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

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
