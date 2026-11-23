import { eq } from "drizzle-orm";
import { settleManual } from "../src/services/settlement.js";
import { cancelRelock, requestRelock } from "../src/services/relocks.js";
import { adminListRelocks } from "../src/services/queries.js";
import { U, day, ok, rejects, setup } from "./lib/harness.js";

const h = await setup();
const { db, s, mgr, alice, admin } = h;

await h.deposit(
    "mgr",
    10_000n * U,
    [{ poolKey: "manager", bps: 10_000 }],
    0n,
    day(0),
);
await h.deposit(
    "alice",
    1_000n * U,
    [{ poolKey: "liquid", bps: 10_000 }],
    10_000n * U,
    day(0),
);
const liquid = (await h.openLots(alice.id))[0];
ok(liquid.key === "liquid", "alice holds a liquid lot");

const itemStatus = async (requestId: string) =>
    (
        await db
            .select()
            .from(s.relockItems)
            .where(eq(s.relockItems.requestId, requestId))
    ).map((x) => x.status);

// Validation
await rejects(
    requestRelock(db, { userId: alice.id, items: [], now: day(5) }),
    "empty relock rejected",
);
await rejects(
    requestRelock(db, {
        userId: alice.id,
        items: [
            {
                lotId: liquid.id,
                targetPoolKey: "liquid" as any,
                amountUsd: 100n * U,
            },
        ],
        now: day(5),
    }),
    "target must be a lock tier",
);
await rejects(
    requestRelock(db, {
        userId: alice.id,
        items: [
            {
                lotId: liquid.id,
                targetPoolKey: "lock_2m",
                amountUsd: 5_000n * U,
            },
        ],
        now: day(5),
    }),
    "amount over available rejected",
);
const mgrLot = (await h.openLots(mgr.id))[0];
await rejects(
    requestRelock(db, {
        userId: mgr.id,
        items: [{ lotId: mgrLot.id, targetPoolKey: "lock_2m", max: true }],
        now: day(5),
    }),
    "manager lot cannot be relocked",
);
await rejects(
    requestRelock(db, {
        userId: alice.id,
        items: [{ lotId: mgrLot.id, targetPoolKey: "lock_2m", max: true }],
        now: day(5),
    }),
    "cannot relock someone else's lot",
);

// Queue 400 of 1,000 liquid -> lock_2m: reserved now, applied at next settlement
const r1 = await requestRelock(db, {
    userId: alice.id,
    items: [
        { lotId: liquid.id, targetPoolKey: "lock_2m", amountUsd: 400n * U },
    ],
    now: day(5),
});
ok(
    (await h.openLots(alice.id))[0].reserved > 0n,
    "queued relock reserves source shares",
);
await rejects(
    requestRelock(db, {
        userId: alice.id,
        items: [
            { lotId: liquid.id, targetPoolKey: "lock_3m", amountUsd: 700n * U },
        ],
        now: day(5),
    }),
    "reserved shares cannot be relocked twice",
);

// Admin list: the queued request with its user, tiers and reserved value.
const pendingList = await adminListRelocks(db, "pending");
ok(
    pendingList.length === 1 &&
        pendingList[0].request.id === r1.requestId &&
        pendingList[0].telegramId === alice.telegramId,
    "admin sees the pending relock and its user",
);
const listed = pendingList[0].items[0];
ok(
    listed.sourcePool === "liquid" &&
        listed.targetPool === "lock_2m" &&
        listed.reservedUsd !== null &&
        listed.reservedUsd >= 399n * U &&
        listed.reservedUsd <= 400n * U,
    "admin item shows liquid -> lock_2m and about $400 reserved",
);

const before = await h.totalNav();
await settleManual(db, {
    adminId: admin.id,
    reportedTotalUsd: before + 10n * U,
    confirmLargeMove: true,
    now: day(10),
});
ok(
    (await itemStatus(r1.requestId)).every((x) => x === "applied"),
    "relock applied at settlement",
);
ok(
    (await adminListRelocks(db, "pending")).length === 0 &&
        (await adminListRelocks(db, "applied")).length === 1,
    "admin filter moves it from pending to applied",
);
const lots = await h.openLots(alice.id);
const lock2 = lots.find((l) => l.key === "lock_2m");
ok(!!lock2, "new lock_2m lot created");
ok(
    !!lock2!.maturesAt &&
        lock2!.maturesAt.getTime() >= day(10).getTime() + 55 * 86_400_000,
    "new lock matures ~2 months after the settlement",
);
ok(
    lots.find((l) => l.key === "liquid")!.reserved === 0n,
    "source reservation cleared",
);
ok(
    (await h.totalNav()) === before + 10n * U,
    "relock is value-neutral (NAV == reported)",
);

// Active lock: only a strictly longer tier
await rejects(
    requestRelock(db, {
        userId: alice.id,
        items: [{ lotId: lock2!.id, targetPoolKey: "lock_1m", max: true }],
        now: day(11),
    }),
    "active lock cannot move to a shorter tier",
);
await rejects(
    requestRelock(db, {
        userId: alice.id,
        items: [{ lotId: lock2!.id, targetPoolKey: "lock_2m", max: true }],
        now: day(11),
    }),
    "active lock cannot move to the same tier",
);
const r2 = await requestRelock(db, {
    userId: alice.id,
    items: [{ lotId: lock2!.id, targetPoolKey: "lock_3m", max: true }],
    now: day(11),
});
ok(
    (await h.openLots(alice.id)).find((l) => l.id === lock2!.id)!.reserved > 0n,
    "extension reserves the lock",
);

// Cancel releases; another user cannot cancel
await rejects(
    cancelRelock(db, { requestId: r2.requestId, userId: h.bob.id }),
    "other user cannot cancel relock",
);
await cancelRelock(db, { requestId: r2.requestId, userId: alice.id });
ok(
    (await itemStatus(r2.requestId)).every((x) => x === "cancelled"),
    "cancelled items",
);
ok(
    (await h.openLots(alice.id)).find((l) => l.id === lock2!.id)!.reserved ===
        0n,
    "cancel releases reservation",
);
await rejects(
    cancelRelock(db, { requestId: r2.requestId, userId: alice.id }),
    "cannot cancel twice",
);

// Extend for real, settle, and confirm shares are conserved
const r3 = await requestRelock(db, {
    userId: alice.id,
    items: [{ lotId: lock2!.id, targetPoolKey: "lock_3m", max: true }],
    now: day(12),
});
await settleManual(db, {
    adminId: admin.id,
    reportedTotalUsd: (await h.totalNav()) + 5n * U,
    confirmLargeMove: true,
    now: day(15),
});
ok(
    (await itemStatus(r3.requestId)).every((x) => x === "applied"),
    "extension applied",
);
ok(
    (await h.openLots(alice.id)).some((l) => l.key === "lock_3m"),
    "lock_3m lot exists after extension",
);

await h.checkInvariants("relocks");
console.log("relocks ok");
process.exit(0);
