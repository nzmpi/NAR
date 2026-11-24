import { demoAnswer } from "./demo";

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
        // Dev builds only: a real initData in a production bundle would be a live login.
        (import.meta.env.DEV &&
            (import.meta.env.VITE_DEV_INIT_DATA as string)) ||
        ""
    );
}

const FRIENDLY: Record<string, string> = {
    rate_limited: "Too many requests. Wait a minute and try again.",
    test_env_restricted: "This environment is restricted.",
    blocked: "Your account is blocked.",
    not_allowlisted: "This app is invite-only. Ask the owner to add you.",
    init_data_expired: "Session expired. Reopen the app.",
    bad_init_data: "Open this app from Telegram.",
};

// People without access get the demo app: answers come from sample data and
// nothing leaves the device, except the access routes.
let demo = false;
export const setDemo = (on: boolean) => {
    demo = on;
};
export const DEMO_NOTE = "This is a demo. Request access on Home to use it.";

export async function api<T>(
    path: string,
    opts: {
        method?: "GET" | "POST";
        body?: unknown;
        idempotencyKey?: string;
    } = {},
): Promise<T> {
    if (demo && !path.startsWith("/me/access")) {
        const r = demoAnswer(path, opts.method ?? "GET", opts.body);
        if (r === undefined) throw new ApiError(0, "demo", DEMO_NOTE);
        return r as T;
    }
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
