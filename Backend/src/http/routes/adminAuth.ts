import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { config } from "../../config.js";
import { db } from "../../db/index.js";
import { admins } from "../../db/schema.js";
import {
    buildAuthUrl,
    exchangeCode,
    pkcePair,
    verifyIdToken,
} from "../../auth/oidc.js";
import { signToken, verifyToken } from "../../auth/session.js";
import { AppError } from "../../errors.js";
import { ADMIN_COOKIE, requireAdmin } from "../auth.js";

const FLOW_COOKIE = "nar_oidc";
const FLOW_TTL = 600;
const SESSION_TTL = 8 * 3600;

const safeEqual = (a: string, b: string) => {
    const x = Buffer.from(a),
        y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
};
const fail = () => new AppError("Login failed", 401, "login_failed");

export async function adminAuthRoutes(app: FastifyInstance) {
    const strict = {
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    };
    // Register ADMIN_CALLBACK_URL as an allowed redirect URL in BotFather.
    app.get("/admin/auth/login", strict, async (_req, reply) => {
        const state = randomBytes(16).toString("base64url");
        const nonce = randomBytes(16).toString("base64url");
        const { verifier, challenge } = pkcePair();
        const flow = await signToken(
            { s: state, n: nonce, v: verifier },
            FLOW_TTL,
            "oidc-flow",
        );
        reply.setCookie(FLOW_COOKIE, flow, {
            httpOnly: true,
            secure: config.COOKIE_SECURE,
            sameSite: "lax",
            path: "/admin/auth",
            maxAge: FLOW_TTL,
        });
        return reply.redirect(buildAuthUrl({ state, nonce, challenge }));
    });

    app.get("/admin/auth/callback", strict, async (req, reply) => {
        const q = z
            .object({ code: z.string().min(1), state: z.string().min(1) })
            .safeParse(req.query);
        const flowCookie = req.cookies[FLOW_COOKIE];
        reply.clearCookie(FLOW_COOKIE, { path: "/admin/auth" });
        if (!q.success || !flowCookie) throw fail();

        let flow;
        try {
            flow = await verifyToken(flowCookie, "oidc-flow");
        } catch {
            throw fail();
        }
        if (!safeEqual(String(flow.s), q.data.state)) throw fail();

        const idToken = await exchangeCode(q.data.code, String(flow.v));
        const telegramId = await verifyIdToken(idToken, String(flow.n));

        // Admin allowlist (initially only the owner).
        const [adm] = await db
            .select()
            .from(admins)
            .where(
                and(
                    eq(admins.telegramId, telegramId),
                    eq(admins.isActive, true),
                ),
            )
            .limit(1);
        if (!adm) throw new AppError("Not an administrator", 403, "forbidden");

        const session = await signToken(
            { adm: adm.id },
            SESSION_TTL,
            "admin-session",
        );
        reply.setCookie(ADMIN_COOKIE, session, {
            httpOnly: true,
            secure: config.COOKIE_SECURE,
            sameSite: "lax",
            path: "/",
            maxAge: SESSION_TTL,
        });
        return reply.redirect(config.ADMIN_POST_LOGIN_URL);
    });

    app.post(
        "/admin/auth/logout",
        { preHandler: requireAdmin },
        async (req, reply) => {
            // Revoke every session of this admin, not only this cookie.
            await db
                .update(admins)
                .set({ sessionsValidAfter: new Date() })
                .where(eq(admins.id, req.admin!.id));
            reply.clearCookie(ADMIN_COOKIE, { path: "/" });
            return reply.code(204).send();
        },
    );

    app.get(
        "/admin/me",
        { preHandler: requireAdmin },
        async (req) => req.admin,
    );
}
