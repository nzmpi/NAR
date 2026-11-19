import { eq } from "drizzle-orm";
import { userAllowlist, users } from "../db/schema.js";
import type { Database } from "./types.js";

export type AccessEnv = { appEnv: "test" | "prod"; ownerTelegramId: string };

// test: owner only. prod: owner, existing users, or allowlisted IDs (sign-up gate).
export async function hasAccess(
    db: Database,
    env: AccessEnv,
    telegramId: string,
): Promise<boolean> {
    if (telegramId === env.ownerTelegramId) return true;
    if (env.appEnv === "test") return false;
    const [u] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.telegramId, telegramId))
        .limit(1);
    if (u) return true;
    const [a] = await db
        .select({ id: userAllowlist.telegramId })
        .from(userAllowlist)
        .where(eq(userAllowlist.telegramId, telegramId))
        .limit(1);
    return !!a;
}
