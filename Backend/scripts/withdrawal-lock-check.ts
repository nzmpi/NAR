// #67: the payout is fixed at lock (after a settlement), so what the admin
// sends always matches the record. One fresh database per scenario.
import { eq } from "drizzle-orm";
import { lockWithdrawalLot } from "../src/accounting/withdraw.js";
import { SHARES_PER_MICRO } from "../src/accounting/fixed.js";
import { getPortfolio } from "../src/services/queries.js";
import {
    cancelWithdrawal,
    confirmWithdrawal,
    lockWithdrawal,
    markWithdrawalPaid,
    rejectWithdrawal,
    requestWithdrawal,
} from "../src/services/withdrawals.js";
import { U, day, ok, rejects, setup } from "./lib/harness.js";

const DEST = "0x" + "ab".repeat(20);
const near = (a: bigint, b: bigint, tol = 2n) => a - b <= tol && b - a <= tol;

// Manager 10,000; Alice 1,000 liquid. NAV 11,000.
async function fresh() {
    const h = await setup();
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
    const request = (amountUsd: bigint, withdrawAll = false) =>
        requestWithdrawal(h.db, {
            userId: h.alice.id,
            assetId: h.usdc.id,
            destinationAddress: DEST,
            amountUsd,
            withdrawAll,
            now: day(1),
        });
    const lock = (id: string, reportedTotalUsd: bigint) =>
        lockWithdrawal(h.db, {
            withdrawalId: id,
            adminId: h.admin.id,
            reportedTotalUsd,
            now: day(2),
        });
    const paid = (id: string) =>
        markWithdrawalPaid(h.db, {
            withdrawalId: id,
            adminId: h.admin.id,
            txHash: h.hash(),
        });
    const row = async (id: string) =>
        (
            await h.db
                .select()
                .from(h.s.withdrawals)
                .where(eq(h.s.withdrawals.id, id))
        )[0];
    const aliceValue = async () =>
        (await getPortfolio(h.db, h.alice.id)).totalBalanceUsd;
    return { h, request, lock, paid, row, aliceValue };
}

// Loss of 0.5%: more shares taken, same net, no confirmation.
{
    const t = await fresh();
    const w = await t.request(500n * U);
    const r = await t.lock(w.withdrawalId, 10_945n * U);
    ok(!r.awaitingUser, "loss <= 1%: no confirmation needed");
    ok(r.netUsd === 500n * U, "loss <= 1%: asked net still paid");
    ok(near(await t.aliceValue(), 495n * U), "loss <= 1%: extra shares taken");
    ok(
        (await t.h.totalNav()) === 10_945n * U - 500n * U,
        "loss <= 1%: NAV drops by the net at lock",
    );
    await t.paid(w.withdrawalId);
    await t.h.checkInvariants("loss <= 1%");
}

// Loss of 2%: waits for the user; confirm lets the admin pay.
{
    const t = await fresh();
    const w = await t.request(500n * U);
    const r = await t.lock(w.withdrawalId, 10_780n * U);
    ok(r.awaitingUser, "loss > 1%: waits for the user");
    ok(r.netUsd === 500n * U, "loss > 1%: new terms keep the asked net");
    await rejects(
        t.paid(w.withdrawalId),
        "loss > 1%: cannot mark paid before the user confirms",
    );
    await confirmWithdrawal(t.h.db, {
        withdrawalId: w.withdrawalId,
        userId: t.h.alice.id,
    });
    await t.paid(w.withdrawalId);
    ok((await t.row(w.withdrawalId)).status === "paid", "confirmed then paid");
    await t.h.checkInvariants("loss > 1% confirm");
}

// Loss of 2%: the user declines; the locked funds go back to the lot.
{
    const t = await fresh();
    const w = await t.request(500n * U);
    await t.lock(w.withdrawalId, 10_780n * U);
    await cancelWithdrawal(t.h.db, {
        withdrawalId: w.withdrawalId,
        userId: t.h.alice.id,
    });
    ok(
        (await t.row(w.withdrawalId)).status === "cancelled",
        "loss > 1%: user declines -> cancelled",
    );
    ok(near(await t.aliceValue(), 980n * U), "decline returns the value");
    ok(
        (await t.h.totalNav()) === 10_780n * U,
        "decline restores the fund total",
    );
    await t.h.checkInvariants("loss > 1% decline");
}

// Loss with no free shares left: the payout shrinks.
{
    const t = await fresh();
    const w = await t.request(1_000n * U);
    const r = await t.lock(w.withdrawalId, 10_945n * U);
    ok(!r.awaitingUser, "shrink 0.5%: no confirmation");
    ok(near(r.netUsd, 995n * U), "too few free shares: payout shrinks");
    ok(near(await t.aliceValue(), 0n), "everything was taken");
    await t.h.checkInvariants("shrink");
}

// Gain: the asked amount is paid; unused shares stay in the lot. Mark paid
// never changes the amounts fixed at lock.
{
    const t = await fresh();
    const w = await t.request(500n * U);
    const r = await t.lock(w.withdrawalId, 11_110n * U);
    ok(r.netUsd === 500n * U, "gain: asked amount paid");
    ok(
        (await t.aliceValue()) > 500n * U,
        "gain: unused shares stay in the lot",
    );
    const before = await t.row(w.withdrawalId);
    await t.paid(w.withdrawalId);
    const after = await t.row(w.withdrawalId);
    ok(
        before.grossAmountUsd === after.grossAmountUsd &&
            before.netPayoutUsd === after.netPayoutUsd &&
            before.payoutAmount === after.payoutAmount &&
            before.earlyFeeUsd === after.earlyFeeUsd,
        "mark paid never changes the recorded amounts",
    );
    await t.h.checkInvariants("gain");
}

// Gain with withdraw-all: the payout grows by the gain.
{
    const t = await fresh();
    const w = await t.request(1_000n * U, true);
    const r = await t.lock(w.withdrawalId, 11_110n * U);
    ok(r.netUsd > 1_000n * U, "withdraw-all: payout grows by the gain");
    ok(
        r.netUsd !== r.quotedNetUsd,
        "withdraw-all: user is told (terms changed)",
    );
    ok(near(await t.aliceValue(), 0n), "withdraw-all: nothing left");
    await t.h.checkInvariants("withdraw-all");
}

// Admin rejects after lock: the funds go back; no double lock.
{
    const t = await fresh();
    const w = await t.request(500n * U);
    await t.lock(w.withdrawalId, 10_945n * U);
    await rejects(t.lock(w.withdrawalId, 10_945n * U), "cannot lock twice");
    await rejects(
        cancelWithdrawal(t.h.db, {
            withdrawalId: w.withdrawalId,
            userId: t.h.alice.id,
        }),
        "locked (no new terms): user cannot cancel",
    );
    await rejectWithdrawal(t.h.db, {
        withdrawalId: w.withdrawalId,
        adminId: t.h.admin.id,
        reason: "test",
    });
    ok(near(await t.aliceValue(), 995n * U), "reject after lock returns value");
    ok(
        (await t.h.totalNav()) === 10_945n * U,
        "reject after lock restores the fund total",
    );
    await t.h.checkInvariants("reject after lock");
}

// Early fee is 10% of the gross actually taken when the payout shrinks.
{
    const shares = 1_000n * U * SHARES_PER_MICRO;
    const f = lockWithdrawalLot(
        { assets: 990n * U, shares },
        shares,
        0n,
        1_000n * U,
        true,
        false,
    );
    ok(
        f.grossUsd === 990n * U &&
            f.feeUsd === 99n * U &&
            f.netUsd === 891n * U,
        "shrunk early withdrawal: fee is 10% of the new gross",
    );
}

console.log("withdrawal lock ok");
process.exit(0);
