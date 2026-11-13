import "fastify";
import type { FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { admins, users } from "../db/schema.js";
import { validateInitData } from "../auth/initData.js";
import { verifyToken } from "../auth/session.js";
import { AppError } from "../errors.js";

declare module "fastify" {
    interface FastifyRequest {
        user?: { id: string; telegramId: string; username: string | null };
        admin?: { id: string; telegramId: string };
    }
}

export const ADMIN_COOKIE = "nar_admin";

// Mini App user: `Authorization: tma <initData>`. No separate login.
export async function requireUser(req: FastifyRequest) {
    const header = req.headers.authorization;
    if (!header?.startsWith("tma "))
        throw new AppError("Unauthorized", 401, "unauthorized");

    const { user: tg } = validateInitData(
        header.slice(4),
        config.BOT_TOKEN,
        config.INIT_DATA_MAX_AGE_SECONDS,
    );
    const telegramId = String(tg.id);

    // Test environment: only the owner Telegram account may use it.
    if (config.APP_ENV === "test" && telegramId !== config.OWNER_TELEGRAM_ID)
        throw new AppError(
            "This environment is restricted",
            403,
            "test_env_restricted",
        );

    const username = tg.username ?? null;
    await db
        .insert(users)
        .values({ telegramId, username })
        .onConflictDoNothing({ target: users.telegramId });
    const [u] = await db
        .select()
        .from(users)
        .where(eq(users.telegramId, telegramId))
        .limit(1);
    if (!u) throw new AppError("Unauthorized", 401, "unauthorized");
    if (u.isBlocked) throw new AppError("Account blocked", 403, "blocked");
    if (u.username !== username)
        await db
            .update(users)
            .set({ username, updatedAt: new Date() })
            .where(eq(users.id, u.id));

    req.user = { id: u.id, telegramId, username };
}

// Dashboard admin: signed httpOnly session cookie from Telegram Login (OIDC).
// State-changing requests also need the custom header and exact Origin (CSRF).
export async function requireAdmin(req: FastifyRequest) {
    const token = req.cookies[ADMIN_COOKIE];
    if (!token) throw new AppError("Unauthorized", 401, "unauthorized");

    let adminId: string;
    try {
        const payload = await verifyToken(token, "admin-session");
        adminId = String(payload.adm);
    } catch {
        throw new AppError("Unauthorized", 401, "unauthorized");
    }

    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        if (
            req.headers["x-requested-with"] !== "nar-admin" ||
            req.headers.origin !== config.ADMIN_ORIGIN
        )
            throw new AppError("CSRF check failed", 403, "csrf");
    }

    const [a] = await db
        .select()
        .from(admins)
        .where(and(eq(admins.id, adminId), eq(admins.isActive, true)))
        .limit(1);
    if (!a) throw new AppError("Unauthorized", 401, "unauthorized");
    req.admin = { id: a.id, telegramId: a.telegramId };
}
