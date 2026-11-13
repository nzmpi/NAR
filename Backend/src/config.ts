import "dotenv/config";
import { z } from "zod";

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
});

const env = schema.parse(process.env);
const adminOrigin = new URL(env.ADMIN_ORIGIN).origin;

export const config = {
    ...env,
    ADMIN_ORIGIN: adminOrigin,
    ADMIN_POST_LOGIN_URL: env.ADMIN_POST_LOGIN_URL ?? adminOrigin,
    BOT_ID: env.BOT_TOKEN.split(":")[0],
    COOKIE_SECURE: env.ADMIN_CALLBACK_URL.startsWith("https://"),
    CORS_ORIGIN_LIST: [
        adminOrigin,
        ...env.CORS_ORIGINS.split(",")
            .map((s) => s.trim())
            .filter(Boolean),
    ],
};
