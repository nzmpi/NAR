import { z } from "zod";

const opt = <T extends z.ZodType>(t: T) =>
    z.preprocess((v) => (v === "" ? undefined : v), t.optional());

const schema = z.object({
    PORT: z.coerce.number().int().default(3000),
    HOST: z.string().default("127.0.0.1"),
    // "test" = server-enforced owner-only environment.
    APP_ENV: z.enum(["test", "prod"]).default("test"),
    OWNER_TELEGRAM_ID: z.string().regex(/^[0-9]+$/),

    BOT_TOKEN: z.string().regex(/^[0-9]+:.+$/),
    // Telegram Login (OIDC) client secret from BotFather.
    TELEGRAM_CLIENT_SECRET: z.string().min(1),

    // Browser dashboard origin, e.g. https://admin.example.com
    ADMIN_ORIGIN: z.url(),
    // Public API callback registered in BotFather, e.g.
    // https://api.example.com/admin/auth/callback
    ADMIN_CALLBACK_URL: z.url(),
    ADMIN_POST_LOGIN_URL: z.url().optional(),

    SESSION_SECRET: z.string().min(32),
    // Shared with the Admin Vercel middleware, which adds it to every /admin
    // request with the visitor's IP. Set: /admin requires it. Required in prod.
    ADMIN_PROXY_SECRET: opt(z.string().min(32)),
    // Extra allowed browser origins (the Mini App origin), comma-separated.
    CORS_ORIGINS: z.string().default(""),
    INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(3600),
    SCAN_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(60), // 0 = off
    OUTBOX_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(5), // 0 = off
    SCAN_LOOKBACK_BLOCKS: z.coerce.number().int().positive().default(50000),
    LOG_CHUNK_BLOCKS: z.coerce.number().int().positive().default(2000),
    REORG_OVERLAP_BLOCKS: z.coerce.number().int().min(0).default(30),

    FACTORY_ADDRESS: opt(z.string().regex(/^0x[a-fA-F0-9]{40}$/)),
    VAULT_ARTIFACT_PATH: opt(z.string().min(1)),
    VAULT_CREATION_CODE_HASH: opt(z.string().regex(/^0x[a-fA-F0-9]{64}$/)),

    // Allowed sweep destinations (treasury addresses), comma-separated.
    // Required in prod; empty in test allows any address.
    TREASURY_ADDRESSES: z
        .string()
        .default("")
        .refine(
            (s) =>
                s
                    .split(",")
                    .map((a) => a.trim())
                    .filter(Boolean)
                    .every((a) => /^0x[a-fA-F0-9]{40}$/.test(a)),
            "TREASURY_ADDRESSES must be comma-separated 0x addresses",
        ),

    // Number of reverse-proxy hops in front of the API (0 = none). Needed for the real client IP.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120), // per IP

    // Bot: "off" | "polling" (dev) | "webhook" (prod).
    BOT_MODE: z.enum(["off", "polling", "webhook"]).default("off"),
    MINI_APP_URL: opt(z.url()),
    // Webhook mode: full public URL of POST /telegram/webhook, and a secret (A-Z a-z 0-9 _ -).
    WEBHOOK_URL: opt(z.url()),
    WEBHOOK_SECRET: opt(z.string().regex(/^[A-Za-z0-9_-]{16,256}$/)),
});

const env = schema.parse(process.env);
if (env.BOT_MODE === "webhook" && (!env.WEBHOOK_URL || !env.WEBHOOK_SECRET))
    throw new Error("BOT_MODE=webhook requires WEBHOOK_URL and WEBHOOK_SECRET");
// Vault addresses depend on these exact values; prod never runs without the pin.
if (
    env.APP_ENV === "prod" &&
    (!env.FACTORY_ADDRESS ||
        !env.VAULT_ARTIFACT_PATH ||
        !env.VAULT_CREATION_CODE_HASH)
)
    throw new Error(
        "APP_ENV=prod requires FACTORY_ADDRESS (the proxy), VAULT_ARTIFACT_PATH and VAULT_CREATION_CODE_HASH",
    );
// Behind Caddy the visitor IP is only right with TRUST_PROXY_HOPS=1; at 0 every user shares one rate limit.
if (env.APP_ENV === "prod" && env.TRUST_PROXY_HOPS === 0)
    throw new Error("APP_ENV=prod requires TRUST_PROXY_HOPS (1 behind Caddy)");
if (env.APP_ENV === "prod" && !env.ADMIN_PROXY_SECRET)
    throw new Error("APP_ENV=prod requires ADMIN_PROXY_SECRET");
const adminOrigin = new URL(env.ADMIN_ORIGIN).origin;
const rpcUrls: Record<number, string[]> = {};
for (const [k, v] of Object.entries(process.env)) {
    const m = /^RPC_URL_(\d+)$/.exec(k);
    if (m && v)
        rpcUrls[Number(m[1])] = v
            .split(",")
            .map((u) => u.trim())
            .filter(Boolean);
}

export const config = {
    ...env,
    ADMIN_ORIGIN: adminOrigin,
    ADMIN_POST_LOGIN_URL: env.ADMIN_POST_LOGIN_URL ?? adminOrigin,
    BOT_ID: env.BOT_TOKEN.split(":")[0],
    RPC_URLS: rpcUrls,
    TREASURY_LIST: env.TREASURY_ADDRESSES.split(",")
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean),
    COOKIE_SECURE: env.ADMIN_CALLBACK_URL.startsWith("https://"),
    CORS_ORIGIN_LIST: [
        adminOrigin,
        ...env.CORS_ORIGINS.split(",")
            .map((s) => s.trim())
            .filter(Boolean),
    ],
};
