import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { signToken } from "./session.js";

export const ADMIN_COOKIE = "nar_admin";
export const PROXY_SECRET_HEADER = "x-nar-proxy-secret";
export const CLIENT_IP_HEADER = "x-nar-client-ip";

const DAY_MS = 86_400_000;
export const IDLE_MS = 3 * DAY_MS; // logged out after 3 days without use
export const MAX_MS = 10 * DAY_MS; // and 10 days after login at the latest
export const REFRESH_AFTER_MS = 3_600_000; // re-issue at most once an hour

// Expiry of a cookie issued at `nowMs` for a session that started at `startMs`.
export const sessionExpiryMs = (startMs: number, nowMs: number) =>
    Math.min(nowMs + IDLE_MS, startMs + MAX_MS);

export function hasProxySecret(req: FastifyRequest) {
    const got = req.headers[PROXY_SECRET_HEADER];
    if (!config.ADMIN_PROXY_SECRET || typeof got !== "string") return false;
    const a = Buffer.from(got),
        b = Buffer.from(config.ADMIN_PROXY_SECRET);
    return a.length === b.length && timingSafeEqual(a, b);
}

// Visitor IP as Vercel saw it. Only trusted because /admin requests without
// the proxy secret are refused. Without a secret (local dev) it is req.ip.
export const adminClientIp = (req: FastifyRequest) =>
    config.ADMIN_PROXY_SECRET
        ? String(req.headers[CLIENT_IP_HEADER] ?? "")
        : req.ip;

export const userAgentHash = (req: FastifyRequest) =>
    createHash("sha256")
        .update(req.headers["user-agent"] ?? "")
        .digest("base64url")
        .slice(0, 22);

// Session cookie bound to this IP and browser. `startMs` is the login time:
// it caps the session and is what logout revocation compares against.
export async function issueAdminSession(
    req: FastifyRequest,
    reply: FastifyReply,
    adminId: string,
    startMs: number,
) {
    const now = Date.now();
    const ttl = Math.floor((sessionExpiryMs(startMs, now) - now) / 1000);
    const token = await signToken(
        {
            adm: adminId,
            t: startMs,
            ip: adminClientIp(req),
            ua: userAgentHash(req),
        },
        ttl,
        "admin-session",
    );
    reply.setCookie(ADMIN_COOKIE, token, {
        httpOnly: true,
        secure: config.COOKIE_SECURE,
        sameSite: "lax",
        path: "/",
        maxAge: ttl,
    });
}
