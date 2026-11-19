import { eq } from "drizzle-orm";
import { settleManual } from "../src/services/settlement.js";
import {
    MIN_WITHDRAWAL_USD,
    cancelWithdrawal,
    markWithdrawalPaid,
    previewWithdrawal,
    rejectWithdrawal,
    requestWithdrawal,
} from "../src/services/withdrawals.js";
import { U, day, ok, rejects, setup } from "./lib/harness.js";

const h = await setup();
const { db, s, alice, bob, admin, usdc } = h;
const DEST = "0x" + "ab".repeat(20);

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
await h.deposit(
    "alice",
    1_000n * U,
    [{ poolKey: "lock_3m", bps: 10_000 }],
    11_000n * U,
    day(0),
);
await h.deposit(
    "bob",
    300n * U,
    [{ poolKey: "liquid", bps: 10_000 }],
    12_000n * U,
    day(0),
);
ok((await h.totalNav()) === 12_300n * U, "setup NAV 12,300");

const req = (
    userId: string,
    amountUsd: bigint,
    extra: object = {},
    destinationAddress = DEST,
) => ({
    userId,
    assetId: usdc.id,
    destinationAddress,
    amountUsd,
    now: day(30),
    ...extra,
});
const status = async (id: string) =>
    (await db.select().from(s.withdrawals).where(eq(s.withdrawals.id, id)))[0]
        .status;

// Validation
await rejects(
    requestWithdrawal(db, req(alice.id, MIN_WITHDRAWAL_USD - 1n)),
    "below 5 USD minimum rejected",
);
await rejects(
    requestWithdrawal(db, req(alice.id, 100n * U, {}, "0x123")),
    "bad destination address rejected",
);
await rejects(
    requestWithdrawal(db, req(alice.id, 1_500n * U)),
    "over liquid balance without lock selection rejected",
);

// Preview: liquid only, no fee
const pv = await previewWithdrawal(db, req(alice.id, 500n * U));
ok(
    pv.feeUsd === 0n && pv.grossUsd === 500n * U && pv.netUsd === 500n * U,
    "liquid withdrawal has no fee",
);

// Request then cancel releases the reservation
const w1 = await requestWithdrawal(db, req(alice.id, 500n * U));
const [liquidLot] = (await h.openLots(alice.id)).filter(
    (l) => l.key === "liquid",
);
ok(liquidLot.reserved > 0n, "request reserves lot shares");
await rejects(
    cancelWithdrawal(db, { withdrawalId: w1.withdrawalId, userId: bob.id }),
    "other user cannot cancel",
);
await cancelWithdrawal(db, { withdrawalId: w1.withdrawalId, userId: alice.id });
ok((await status(w1.withdrawalId)) === "cancelled", "cancelled");
ok(
    (await h.openLots(alice.id)).find((l) => l.key === "liquid")!.reserved ===
        0n,
    "cancel releases reservation",
);

// Admin reject releases too
const wb = await requestWithdrawal(db, req(bob.id, 100n * U));
await rejectWithdrawal(db, {
    withdrawalId: wb.withdrawalId,
    adminId: admin.id,
    reason: "test",
});
ok((await status(wb.withdrawalId)) === "rejected", "rejected");
ok(
    (await h.openLots(bob.id))[0].reserved === 0n,
    "reject releases reservation",
);

// Early lock: all liquid (1,000) + 100 from the 3-month lock -> 10% fee on the 100
const lock = (await h.openLots(alice.id)).find((l) => l.key === "lock_3m")!;
const w2 = await requestWithdrawal(
    db,
    req(alice.id, 1_100n * U, {
        lockSelections: [{ lotId: lock.id, grossUsd: 100n * U }],
    }),
);
ok(w2.grossUsd === 1_100n * U, "quoted gross 1,100");
ok(w2.feeUsd === 10n * U, "10% early fee on the 100 USD lock portion");
ok(w2.netUsd === 1_090n * U, "quoted net 1,090");
await rejects(
    requestWithdrawal(db, req(alice.id, 100n * U)),
    "reserved liquid cannot be requested twice",
);

// Pay: settle first, then burn. Pool NAV drops by the net payout only.
await rejects(
    markWithdrawalPaid(db, {
        withdrawalId: w2.withdrawalId,
        adminId: admin.id,
        txHash: "0x12",
        reportedTotalUsd: 12_400n * U,
        confirmLargeMove: true,
        now: day(30),
    }),
    "bad tx hash rejected",
);
const paid = await markWithdrawalPaid(db, {
    withdrawalId: w2.withdrawalId,
    adminId: admin.id,
    txHash: h.hash(),
    reportedTotalUsd: 12_400n * U,
    confirmLargeMove: true,
    now: day(30),
});
ok((await status(w2.withdrawalId)) === "paid", "paid");
ok(paid.grossUsd >= 1_100n * U, "gross at settled prices >= quote (NAV grew)");
ok(paid.feeUsd > 0n && paid.feeUsd < 20n * U, "fee ~10% of lock portion");
ok(paid.netUsd === paid.grossUsd - paid.feeUsd, "net = gross - fee");
ok(
    (await h.totalNav()) === 12_400n * U - paid.netUsd,
    "pool NAV == reported - net payout (fee stays in manager pool)",
);
await rejects(
    markWithdrawalPaid(db, {
        withdrawalId: w2.withdrawalId,
        adminId: admin.id,
        txHash: h.hash(),
        reportedTotalUsd: 12_400n * U,
        confirmLargeMove: true,
        now: day(31),
    }),
    "cannot pay twice",
);

// Reservation excluded from maturity: bob's later settlement still works with a pending request
const wb2 = await requestWithdrawal(db, {
    ...req(bob.id, 300n * U),
    now: day(40),
});
await settleManual(db, {
    adminId: admin.id,
    reportedTotalUsd: (await h.totalNav()) + 50n * U,
    confirmLargeMove: true,
    now: day(45),
});
ok(
    (await status(wb2.withdrawalId)) === "pending",
    "pending withdrawal survives a settlement",
);

await h.checkInvariants("withdrawals");
console.log("withdrawals ok");
process.exit(0);
