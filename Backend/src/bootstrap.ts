import { db } from "./db/index.js";
import { admins } from "./db/schema.js";
import { config } from "./config.js";

// The admin allowlist starts with only the owner account.
export async function ensureOwnerAdmin() {
    await db
        .insert(admins)
        .values({ telegramId: config.OWNER_TELEGRAM_ID, role: "owner" })
        .onConflictDoNothing({ target: admins.telegramId });
}
