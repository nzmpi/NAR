// config.ts validates env on import, and CI has no .env: set a fixed test env
// first, then load the modules.
Object.assign(process.env, {
    APP_ENV: "test",
    // Nothing listens on port 1: a request that passes the binding check
    // fails at the admin lookup instead of returning 401.
    DATABASE_URL: "postgres://x:x@127.0.0.1:1/x",
    OWNER_TELEGRAM_ID: "1",
    BOT_TOKEN: "1:test",
    TELEGRAM_CLIENT_SECRET: "test",
    ADMIN_ORIGIN: "https://admin.test",
    ADMIN_CALLBACK_URL: "https://admin.test/admin/auth/callback",
    SESSION_SECRET: "s".repeat(32),
    ADMIN_PROXY_SECRET: "p".repeat(32),
    BOT_MODE: "off",
    FACTORY_ADDRESS: "",
    VAULT_ARTIFACT_PATH: "",
    VAULT_CREATION_CODE_HASH: "",
});
const { IDLE_MS, MAX_MS, sessionExpiryMs } =
    await import("../src/auth/adminSession.js");
const { requireAdmin } = await import("../src/http/auth.js");
const { signToken } = await import("../src/auth/session.js");
const { pool } = await import("../src/db/index.js");

const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL " + m);
    console.log("ok  " + m);
};
const DAY = 86_400_000;
const start = 1_000_000_000_000;

ok(IDLE_MS === 3 * DAY && MAX_MS === 10 * DAY, "3 days idle, 10 days max");
ok(sessionExpiryMs(start, start) === start + 3 * DAY, "login: 3 days");
ok(
    sessionExpiryMs(start, start + 5 * DAY) === start + 8 * DAY,
    "use on day 5 slides to day 8",
);
ok(
    sessionExpiryMs(start, start + 9 * DAY) === start + 10 * DAY,
    "use on day 9 is capped at day 10",
);

// Binding: the cookie only works from the IP and browser it was issued to.
const { createHash } = await import("node:crypto");
const ua = "CheckUA/1.0";
const token = await signToken(
    {
        adm: "00000000-0000-0000-0000-000000000000",
        t: Date.now(),
        ip: "1.1.1.1",
        ua: createHash("sha256").update(ua).digest("base64url").slice(0, 22),
    },
    3600,
    "admin-session",
);
const status = async (ip: string, agent: string) => {
    const req = {
        method: "GET",
        ip: "9.9.9.9",
        cookies: { nar_admin: token },
        headers: { "x-nar-client-ip": ip, "user-agent": agent },
    };
    try {
        await requireAdmin(req as never, {} as never);
        return 200;
    } catch (e) {
        return (e as { status?: number }).status ?? 0; // 0: DB not reachable
    }
};
ok((await status("2.2.2.2", ua)) === 401, "other IP -> 401");
ok((await status("1.1.1.1", "Other/2")) === 401, "other browser -> 401");
ok(
    (await status("1.1.1.1", ua)) !== 401,
    "same IP and browser pass the binding check",
);
await pool.end();
console.log("admin session ok");
