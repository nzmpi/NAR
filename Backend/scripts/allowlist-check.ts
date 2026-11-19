import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as s from "../src/db/schema.js";
import { hasAccess } from "../src/services/allowlist.js";

const ok = (c: unknown, m: string) => {
    if (!c) throw new Error("FAIL " + m);
    console.log("ok  " + m);
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

const test = { appEnv: "test", ownerTelegramId: "1" } as const;
const prod = { appEnv: "prod", ownerTelegramId: "1" } as const;

const [admin] = await db
    .insert(s.admins)
    .values({ telegramId: "1" })
    .returning();
await db.insert(s.users).values({ telegramId: "2" });
await db.insert(s.userAllowlist).values({ telegramId: "3", addedBy: admin.id });

ok(await hasAccess(db, test, "1"), "test: owner allowed");
ok(!(await hasAccess(db, test, "2")), "test: existing non-owner denied");
ok(!(await hasAccess(db, test, "3")), "test: allowlisted non-owner denied");
ok(await hasAccess(db, prod, "1"), "prod: owner allowed");
ok(await hasAccess(db, prod, "2"), "prod: existing user allowed");
ok(await hasAccess(db, prod, "3"), "prod: allowlisted new user allowed");
ok(!(await hasAccess(db, prod, "4")), "prod: unknown user denied");

await client.close();
console.log("allowlist ok");
