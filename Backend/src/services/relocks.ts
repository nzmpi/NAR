import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
    auditLogs,
    positionLots,
    relockItems,
    relockRequests,
    users,
} from "../db/schema.js";
import {
    mint,
    burn,
    clonePools,
    sharesForWithdrawal,
    LOCK_KEYS,
    LOCK_MONTHS,
    type LockKey,
    type PoolKey,
    type Pools,
} from "../accounting/pools.js";
import { AppError } from "../errors.js";
import { postLedger } from "./ledger.js";
import { loadPoolsForUpdate, type PoolIds } from "./poolStore.js";
import { addMonths } from "./time.js";
import type { Database, Tx } from "./types.js";

export interface RelockItemInput {
    lotId: string;
    targetPoolKey: LockKey;
    amountUsd?: bigint; // micro-USD value to relock from this lot
    max?: boolean; // all remaining available value of the lot
}

const isActiveLock = (key: PoolKey, maturesAt: Date | null, now: Date) =>
    LOCK_KEYS.includes(key as LockKey) &&
    maturesAt !== null &&
    maturesAt.getTime() > now.getTime();

// User queues a relock. Source shares are reserved immediately (so they cannot
// be withdrawn or relocked twice). It is applied at the next settlement.
// Rules: liquid or matured value can go to any lock tier; an active lock can
// only be extended to a strictly longer tier. No fee. New lot, new maturity.
export function requestRelock(
    database: Database,
    i: {
        userId: string;
        items: RelockItemInput[];
        now?: Date;
    },
) {
    return database.transaction(async (tx) => {
        const now = i.now ?? new Date();
        if (!i.items.length)
            throw new AppError("Nothing to relock", 400, "bad_request");

        const [user] = await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.id, i.userId), eq(users.isBlocked, false)))
            .limit(1);
        if (!user)
            throw new AppError("Active user not found", 404, "user_not_found");

        const { pools, ids } = await loadPoolsForUpdate(tx);
        const keyById = new Map(
            Object.entries(ids).map(([k, id]) => [id, k as PoolKey]),
        );

        const lotIds = [...new Set(i.items.map((x) => x.lotId))];
        const lots = await tx
            .select()
            .from(positionLots)
            .where(
                and(
                    eq(positionLots.userId, i.userId),
                    isNull(positionLots.closedAt),
                    inArray(positionLots.id, lotIds),
                ),
            )
            .for("update");
        if (lots.length !== lotIds.length)
            throw new AppError("Position not found", 404, "lot_not_found");

        const reservedNow = new Map<string, bigint>();
        const prepared: { item: RelockItemInput; shares: bigint }[] = [];
        for (const item of i.items) {
            const lot = lots.find((l) => l.id === item.lotId)!;
            const key = keyById.get(lot.poolId)!;
            if (key === "manager")
                throw new AppError(
                    "Manager positions cannot be relocked",
                    400,
                    "bad_selection",
                );
            if (!LOCK_KEYS.includes(item.targetPoolKey))
                throw new AppError(
                    "Target must be a lock tier",
                    400,
                    "bad_target",
                );
            if (
                isActiveLock(key, lot.maturesAt, now) &&
                LOCK_MONTHS[item.targetPoolKey] <= LOCK_MONTHS[key]
            )
                throw new AppError(
                    "An active lock can only be extended to a longer tier",
                    400,
                    "bad_target",
                );

            const avail =
                BigInt(lot.shares) -
                BigInt(lot.reservedShares) -
                (reservedNow.get(lot.id) ?? 0n);
            let shares: bigint;
            if (item.max) {
                shares = avail;
            } else {
                if (item.amountUsd === undefined || item.amountUsd <= 0n)
                    throw new AppError("Invalid amount", 400, "bad_amount");
                shares = sharesForWithdrawal(pools[key], item.amountUsd);
                if (shares > avail)
                    throw new AppError(
                        "Amount exceeds the available value of the position",
                        400,
                        "bad_amount",
                    );
            }
            if (shares <= 0n)
                throw new AppError(
                    "Nothing available to relock in this position",
                    400,
                    "bad_amount",
                );
            reservedNow.set(lot.id, (reservedNow.get(lot.id) ?? 0n) + shares);
            prepared.push({ item, shares });
        }

        const [req] = await tx
            .insert(relockRequests)
            .values({ userId: i.userId, status: "pending" })
            .returning({ id: relockRequests.id });
        for (const p of prepared)
            await tx.insert(relockItems).values({
                requestId: req.id,
                sourceLotId: p.item.lotId,
                targetPoolId: ids[p.item.targetPoolKey],
                amountUsd: p.item.max ? null : p.item.amountUsd!.toString(),
                isMax: !!p.item.max,
                reservedShares: p.shares.toString(),
            });
        for (const [lotId, shares] of reservedNow)
            await tx
                .update(positionLots)
                .set({
                    reservedShares: sql`${positionLots.reservedShares} + ${shares.toString()}::numeric`,
                    updatedAt: now,
                })
                .where(eq(positionLots.id, lotId));

        return { requestId: req.id as string, items: prepared.length };
    });
}

// User can cancel while the request is still queued.
export function cancelRelock(
    database: Database,
    i: { requestId: string; userId: string },
) {
    return database.transaction(async (tx) => {
        const [req] = await tx
            .select()
            .from(relockRequests)
            .where(
                and(
                    eq(relockRequests.id, i.requestId),
                    eq(relockRequests.userId, i.userId),
                ),
            )
            .for("update");
        if (!req)
            throw new AppError("Relock request not found", 404, "not_found");
        if (req.status !== "pending")
            throw new AppError(
                "Only a queued relock can be cancelled",
                409,
                "bad_state",
            );
        const items = await tx
            .select()
            .from(relockItems)
            .where(
                and(
                    eq(relockItems.requestId, req.id),
                    eq(relockItems.status, "pending"),
                ),
            );
        for (const it of items)
            await tx
                .update(positionLots)
                .set({
                    reservedShares: sql`${positionLots.reservedShares} - ${it.reservedShares}::numeric`,
                    updatedAt: new Date(),
                })
                .where(eq(positionLots.id, it.sourceLotId));
        await tx
            .update(relockItems)
            .set({ status: "cancelled" })
            .where(
                and(
                    eq(relockItems.requestId, req.id),
                    eq(relockItems.status, "pending"),
                ),
            );
        await tx
            .update(relockRequests)
            .set({ status: "cancelled" })
            .where(eq(relockRequests.id, req.id));
    });
}

// Called by settleInTx after the settlement and maturity conversions, inside
// its transaction, at that settlement's prices. A bad item is marked failed
// and its reservation released; it never blocks the settlement.
export async function applyPendingRelocks(
    tx: Tx,
    c: {
        state: Pools;
        ids: PoolIds;
        now: Date;
        settlementId: string;
        adminId: string | null;
    },
): Promise<{ state: Pools; applied: number; failed: number }> {
    const { ids, now } = c;
    const keyById = new Map(
        Object.entries(ids).map(([k, id]) => [id, k as PoolKey]),
    );
    let state = clonePools(c.state);

    const queued = await tx
        .select({ item: relockItems, userId: relockRequests.userId })
        .from(relockItems)
        .innerJoin(relockRequests, eq(relockRequests.id, relockItems.requestId))
        .where(eq(relockItems.status, "pending"))
        .orderBy(relockRequests.createdAt, relockItems.id)
        .for("update", { of: relockItems });

    let applied = 0;
    let failed = 0;
    const touched = new Set<string>();
    const log: { itemId: string; usd: string; toPool: string }[] = [];

    for (const { item, userId } of queued) {
        touched.add(item.requestId);
        const [lot] = await tx
            .select()
            .from(positionLots)
            .where(eq(positionLots.id, item.sourceLotId))
            .for("update");

        const fail = async (reason: string) => {
            failed++;
            if (lot)
                await tx
                    .update(positionLots)
                    .set({
                        reservedShares: sql`${positionLots.reservedShares} - ${item.reservedShares}::numeric`,
                        updatedAt: now,
                    })
                    .where(eq(positionLots.id, lot.id));
            await tx
                .update(relockItems)
                .set({ status: "failed", failureReason: reason })
                .where(eq(relockItems.id, item.id));
        };

        if (!lot || lot.closedAt) {
            await fail("Source position is no longer open");
            continue;
        }
        const key = keyById.get(lot.poolId)!;
        const target = keyById.get(item.targetPoolId)!;
        if (
            isActiveLock(key, lot.maturesAt, now) &&
            LOCK_MONTHS[target] <= LOCK_MONTHS[key]
        ) {
            await fail("An active lock can only be extended to a longer tier");
            continue;
        }
        if (state[key].shares === 0n) {
            await fail("Source pool is empty");
            continue;
        }

        const reserved = BigInt(item.reservedShares);
        let burnShares = reserved;
        if (!item.isMax) {
            const needed = sharesForWithdrawal(
                state[key],
                BigInt(item.amountUsd!),
            );
            if (needed < reserved) burnShares = needed;
        }
        const b = burn(state[key], burnShares);
        if (b.usd <= 0n) {
            await fail("Position has no value");
            continue;
        }

        let m;
        try {
            const after = key === target ? b.state : state[target];
            m = mint(after, b.usd);
        } catch {
            await fail("Amount too small to relock");
            continue;
        }
        state[key] = b.state;
        state[target] = m.state;

        const lotShares = BigInt(lot.shares);
        const carried = (BigInt(lot.principalUsd) * burnShares) / lotShares;
        const newShares = lotShares - burnShares;
        await tx
            .update(positionLots)
            .set({
                shares: newShares.toString(),
                reservedShares: (
                    BigInt(lot.reservedShares) - reserved
                ).toString(),
                principalUsd: (BigInt(lot.principalUsd) - carried).toString(),
                // The cap is split by shares between the part that stays and
                // the new lot, so relocking never adds cap.
                ...(lot.capBaseUsd !== null && {
                    capBaseUsd: (
                        (BigInt(lot.capBaseUsd) * newShares) /
                        lotShares
                    ).toString(),
                    capUsedUsd: (
                        (BigInt(lot.capUsedUsd) * newShares) /
                        lotShares
                    ).toString(),
                }),
                closedAt: newShares === 0n ? now : null,
                updatedAt: now,
            })
            .where(eq(positionLots.id, lot.id));

        const [nl] = await tx
            .insert(positionLots)
            .values({
                userId,
                poolId: item.targetPoolId,
                shares: m.shares.toString(),
                principalUsd: carried.toString(),
                openedAt: now,
                maturesAt: addMonths(now, LOCK_MONTHS[target]),
                sourceType: "relock",
                sourceId: item.id,
                parentLotId: lot.id,
                capYearStart: lot.capYearStart,
                ...(lot.capBaseUsd !== null && {
                    capBaseUsd: (
                        (BigInt(lot.capBaseUsd) * burnShares) /
                        lotShares
                    ).toString(),
                    capUsedUsd: (
                        (BigInt(lot.capUsedUsd) * burnShares) /
                        lotShares
                    ).toString(),
                }),
            })
            .returning({ id: positionLots.id });

        await tx
            .update(relockItems)
            .set({
                status: "applied",
                appliedShares: burnShares.toString(),
                appliedUsd: b.usd.toString(),
                resultLotId: nl.id,
            })
            .where(eq(relockItems.id, item.id));

        await postLedger(tx, {
            type: "relock",
            referenceType: "position_lot",
            referenceId: nl.id,
            adminId: c.adminId,
            lines: [
                {
                    account: "pool_equity",
                    poolId: ids[key],
                    userId,
                    direction: "debit",
                    amountUsd: b.usd,
                },
                {
                    account: "pool_equity",
                    poolId: ids[target],
                    userId,
                    direction: "credit",
                    amountUsd: b.usd,
                },
            ],
        });
        log.push({ itemId: item.id, usd: b.usd.toString(), toPool: target });
        applied++;
    }

    for (const requestId of touched) {
        const rows = await tx
            .select({ status: relockItems.status })
            .from(relockItems)
            .where(eq(relockItems.requestId, requestId));
        if (rows.some((r) => r.status === "pending")) continue;
        await tx
            .update(relockRequests)
            .set({
                status: rows.every((r) => r.status === "failed")
                    ? "failed"
                    : "applied",
                appliedAt: now,
                settlementId: c.settlementId,
            })
            .where(eq(relockRequests.id, requestId));
    }

    if (c.adminId && applied > 0)
        await tx.insert(auditLogs).values({
            adminId: c.adminId,
            action: "relock.applied",
            entityType: "settlement",
            entityId: c.settlementId,
            details: { applied, failed, items: log },
        });

    return { state, applied, failed };
}
