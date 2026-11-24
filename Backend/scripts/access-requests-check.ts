// accessRequests.ts imports the outbox, which loads config.ts: set a fixed
// test env first (CI has no .env), then import.
Object.assign(process.env, {
    // Config only; the service gets the prod access env passed in below.
    APP_ENV: "test",
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
const fs = await import("node:fs");
const { PGlite } = await import("@electric-sql/pglite");
const { drizzle } = await import("drizzle-orm/pglite");
const { eq } = await import("drizzle-orm");
const s = await import("../src/db/schema.js");
const a = await import("../src/services/accessRequests.js");
const { pool } = await import("../src/db/index.js");

const ok = (c: unknown, m: string) => {
    if (!c) throw new Error("FAIL " + m);
    console.log("ok  " + m);
};
const rejects = async (p: Promise<unknown>, code: string, m: string) => {
    try {
        await p;
    } catch (e) {
        return ok((e as { code?: string }).code === code, m);
    }
    ok(false, m);
};

const client = new PGlite();
const db = drizzle(client);
for (const f of fs
    .readdirSync("drizzle")
    .filter((x: string) => x.endsWith(".sql"))
    .sort())
    for (const st of fs
        .readFileSync("drizzle/" + f, "utf8")
        .split("--> statement-breakpoint"))
        if (st.trim()) await client.exec(st);

const env = { appEnv: "prod", ownerTelegramId: "1" } as const;
const [admin] = await db
    .insert(s.admins)
    .values({ telegramId: "1" })
    .returning();
const t0 = new Date("2026-01-01T00:00:00Z");
const day = (d: number) => new Date(t0.getTime() + d * 86_400_000);
const req = (id: string, now: Date) =>
    a.requestAccess(db, env, {
        telegramId: id,
        username: "u" + id,
        firstName: "F",
        now,
    });
const status = async (id: string, now = t0) =>
    (await a.accessStatus(db, env, id, now)).status;
const outbox = async (chat: string) =>
    db
        .select()
        .from(s.notificationOutbox)
        .where(eq(s.notificationOutbox.chatId, chat));

ok((await status("1")) === "approved", "owner is approved");
ok((await status("5")) === "none", "unknown user: none");
await req("5", t0);
ok((await status("5")) === "pending", "request -> pending");
await req("5", day(1));
ok(
    (await a.listAccessRequests(db, "pending")).length === 1,
    "second request while pending is a no-op",
);

// Reject: no access, can ask again only after 30 days.
await a.decideAccessRequest(db, {
    telegramId: "5",
    adminId: admin.id,
    approve: false,
    now: day(2),
});
const r = await a.accessStatus(db, env, "5", day(3));
ok(r.status === "rejected" && "canRequest" in r && !r.canRequest, "rejected");
ok((await outbox("5")).length === 1, "rejection message queued by chat id");
await rejects(
    req("5", day(31)),
    "rejected_recently",
    "re-request before 30 days",
);
await req("5", day(32));
ok((await status("5", day(32))) === "pending", "re-request after 30 days");
await rejects(
    a.decideAccessRequest(db, {
        telegramId: "6",
        adminId: admin.id,
        approve: true,
    }),
    "not_found",
    "deciding a missing request fails",
);

// Approve: allowlisted, approved, message queued.
await a.decideAccessRequest(db, {
    telegramId: "5",
    adminId: admin.id,
    approve: true,
    now: day(33),
});
ok((await status("5", day(33))) === "approved", "approve grants access");
ok(
    (
        await db
            .select()
            .from(s.userAllowlist)
            .where(eq(s.userAllowlist.telegramId, "5"))
    ).length === 1,
    "approve adds to the allowlist",
);
ok((await outbox("5")).length === 2, "approval message queued");
await rejects(
    a.decideAccessRequest(db, {
        telegramId: "5",
        adminId: admin.id,
        approve: false,
    }),
    "bad_state",
    "a decided request cannot be decided again",
);
ok(
    (await req("5", day(34))).status === "approved",
    "request with access is a no-op",
);

// Manual allowlist add closes a pending request, so it can't be rejected.
await req("8", t0);
await db.insert(s.userAllowlist).values({ telegramId: "8", addedBy: admin.id });
await a.closePendingRequest(db, "8", admin.id);
ok(
    (await a.listAccessRequests(db, "pending")).every(
        (x) => x.telegramId !== "8",
    ),
    "manual add closes the pending request",
);
await rejects(
    a.decideAccessRequest(db, {
        telegramId: "8",
        adminId: admin.id,
        approve: false,
    }),
    "bad_state",
    "closed request cannot be rejected",
);

// Blocked users are not offered a request.
await db.insert(s.users).values({ telegramId: "5", isBlocked: true });
ok((await status("5", day(35))) === "blocked", "blocked user: blocked");

await client.close();
await pool.end();
console.log("access requests ok");
