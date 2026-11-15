import "dotenv/config";
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
    // Extra allowed browser origins (the Mini App origin), comma-separated.
    CORS_ORIGINS: z.string().default(""),
    INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(3600),
    SCAN_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(60), // 0 = off
    SCAN_LOOKBACK_BLOCKS: z.coerce.number().int().positive().default(50000),
    LOG_CHUNK_BLOCKS: z.coerce.number().int().positive().default(2000),
    REORG_OVERLAP_BLOCKS: z.coerce.number().int().min(0).default(30),

    FACTORY_ADDRESS: opt(z.string().regex(/^0x[a-fA-F0-9]{40}$/)),
    VAULT_ARTIFACT_PATH: opt(z.string().min(1)),
    VAULT_CREATION_CODE_HASH: opt(z.string().regex(/^0x[a-fA-F0-9]{64}$/)),
});

const env = schema.parse(process.env);
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
    COOKIE_SECURE: env.ADMIN_CALLBACK_URL.startsWith("https://"),
    CORS_ORIGIN_LIST: [
        adminOrigin,
        ...env.CORS_ORIGINS.split(",")
            .map((s) => s.trim())
            .filter(Boolean),
    ],
};
