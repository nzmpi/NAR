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

export function getInitData(): string {
    return (
        window.Telegram?.WebApp?.initData ||
        (import.meta.env.VITE_DEV_INIT_DATA as string) ||
        ""
    );
}

const FRIENDLY: Record<string, string> = {
    rate_limited: "Too many requests. Wait a minute and try again.",
    test_env_restricted: "This environment is restricted.",
    blocked: "Your account is blocked.",
    init_data_expired: "Session expired. Reopen the app.",
    bad_init_data: "Open this app from Telegram.",
};

export async function api<T>(
    path: string,
    opts: {
        method?: "GET" | "POST";
        body?: unknown;
        idempotencyKey?: string;
    } = {},
): Promise<T> {
    const headers: Record<string, string> = {
        Authorization: `tma ${getInitData()}`,
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    let res: Response;
    try {
        res = await fetch(BASE + path, {
            method: opts.method ?? "GET",
            headers,
            body:
                opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        });
    } catch {
        throw new ApiError(
            0,
            "network",
            "Network error. Check your connection.",
        );
    }
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const code = (data as { code?: string }).code ?? "error";
        throw new ApiError(
            res.status,
            code,
            FRIENDLY[code] ??
                (data as { error?: string }).error ??
                "Something went wrong",
        );
    }
    return data as T;
}

export const newKey = () => crypto.randomUUID();
