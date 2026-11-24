import { and, desc, eq } from "drizzle-orm";
import {
    accessRequests,
    auditLogs,
    userAllowlist,
    users,
} from "../db/schema.js";
import { AppError } from "../errors.js";
import { hasAccess, type AccessEnv } from "./allowlist.js";
import { enqueueChatNotification } from "./outbox.js";
import type { Database } from "./types.js";

// A rejected user can ask again this long after the decision.
export const RETRY_AFTER_MS = 30 * 86_400_000;

export type AccessStatus =
    | { status: "approved" | "blocked" | "pending" }
    | { status: "none"; canRequest: true }
    | { status: "rejected"; canRequest: boolean; retryAt: Date };

// What a Mini App or bot user sees before (and after) approval.
export async function accessStatus(
    database: Database,
    env: AccessEnv,
    telegramId: string,
    now = new Date(),
): Promise<AccessStatus> {
    if (await hasAccess(database, env, telegramId)) {
        const [u] = await database
            .select({ isBlocked: users.isBlocked })
            .from(users)
            .where(eq(users.telegramId, telegramId))
            .limit(1);
        return { status: u?.isBlocked ? "blocked" : "approved" };
    }
    const [r] = await database
        .select()
        .from(accessRequests)
        .where(eq(accessRequests.telegramId, telegramId))
        .limit(1);
    if (r?.status === "pending") return { status: "pending" };
    if (r?.status === "rejected" && r.decidedAt) {
        const retryAt = new Date(r.decidedAt.getTime() + RETRY_AFTER_MS);
        return {
            status: "rejected",
            canRequest: now >= retryAt,
            retryAt,
        };
    }
    // No request, or approved but later removed from the allowlist.
    return { status: "none", canRequest: true };
}

// Creates or renews a pending request. A no-op when one is already pending
// or the user already has access.
export async function requestAccess(
    database: Database,
    env: AccessEnv,
    i: {
        telegramId: string;
        username: string | null;
        firstName: string | null;
        now?: Date;
    },
): Promise<AccessStatus> {
    const now = i.now ?? new Date();
    const st = await accessStatus(database, env, i.telegramId, now);
    if (!("canRequest" in st)) return st;
    if (!st.canRequest)
        throw new AppError(
            "Your request was declined recently; try again later",
            429,
            "rejected_recently",
        );
    const row = {
        username: i.username,
        firstName: i.firstName,
        status: "pending",
        requestedAt: now,
        decidedAt: null,
        decidedBy: null,
    };
    await database
        .insert(accessRequests)
        .values({ telegramId: i.telegramId, ...row })
        .onConflictDoUpdate({ target: accessRequests.telegramId, set: row });
    return { status: "pending" };
}

export function listAccessRequests(
    database: Database,
    status?: string,
    limit = 100,
) {
    return database
        .select()
        .from(accessRequests)
        .where(status ? eq(accessRequests.status, status) : undefined)
        .orderBy(desc(accessRequests.requestedAt))
        .limit(limit);
}

// Manual allowlist add answers any pending request from that ID, so a later
// reject can't tell someone who has access that they were declined.
export async function closePendingRequest(
    database: Database,
    telegramId: string,
    adminId: string,
) {
    await database
        .update(accessRequests)
        .set({ status: "approved", decidedAt: new Date(), decidedBy: adminId })
        .where(
            and(
                eq(accessRequests.telegramId, telegramId),
                eq(accessRequests.status, "pending"),
            ),
        );
}

// Approve adds the ID to the allowlist. The user gets a bot message either way.
export function decideAccessRequest(
    database: Database,
    i: { telegramId: string; adminId: string; approve: boolean; now?: Date },
) {
    const now = i.now ?? new Date();
    return database.transaction(async (tx) => {
        const [r] = await tx
            .select()
            .from(accessRequests)
            .where(eq(accessRequests.telegramId, i.telegramId))
            .for("update");
        if (!r) throw new AppError("Request not found", 404, "not_found");
        if (r.status !== "pending")
            throw new AppError("Request is not pending", 409, "bad_state");
        if (i.approve)
            await tx
                .insert(userAllowlist)
                .values({
                    telegramId: r.telegramId,
                    note: "access request",
                    addedBy: i.adminId,
                })
                .onConflictDoNothing();
        await tx
            .update(accessRequests)
            .set({
                status: i.approve ? "approved" : "rejected",
                decidedAt: now,
                decidedBy: i.adminId,
            })
            .where(
                and(
                    eq(accessRequests.telegramId, r.telegramId),
                    eq(accessRequests.status, "pending"),
                ),
            );
        await tx.insert(auditLogs).values({
            adminId: i.adminId,
            action: i.approve ? "access.approved" : "access.rejected",
            entityType: "access_request",
            entityId: r.telegramId,
            details: { username: r.username },
        });
        await enqueueChatNotification(
            tx,
            r.telegramId,
            i.approve
                ? "Your access to NAR is approved. Open the app to get started."
                : "Your request to join NAR was declined.",
        );
    });
}
