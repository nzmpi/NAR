import { settleManual } from "../src/services/settlement.js";
import {
    adminPerformance,
    computePerformance,
} from "../src/services/history.js";
import { eq } from "drizzle-orm";
import { U, day, ok, setup } from "./lib/harness.js";

const h = await setup();
const { db, s, alice, bob, admin } = h;

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

// Gain: +100 over 30 days
await settleManual(db, {
    adminId: admin.id,
    reportedTotalUsd: 11_100n * U,
    confirmLargeMove: true,
    now: day(30),
});
const up = await computePerformance(db, alice.id, "all", day(30));
ok(
    up.cumulativeReturn !== null && up.cumulativeReturn > 0,
    "positive return after a gain",
);
ok(up.points.length >= 1, "performance has points");
// Pool return comes from yield allocations, not the share price (which profit minting leaves flat).
// Manager takes 100 * 10k/11k = 90.909090; alice's liquid lot gets 9.090910 on 1,000.
const apUp = await adminPerformance(db, "all", day(30));
const ret = (k: string) =>
    apUp.pools.find((p) => p.pool === k)?.cumulativeReturn ?? 0;
ok(Math.abs(ret("liquid") - 0.00909091) < 1e-9, "admin liquid pool return");
ok(Math.abs(ret("manager") - 0.009090909) < 1e-9, "admin manager pool return");

// Loss: NAV falls to 10,000 (~ -10%)
await settleManual(db, {
    adminId: admin.id,
    reportedTotalUsd: 10_000n * U,
    confirmLargeMove: true,
    now: day(60),
});
const down = await computePerformance(db, alice.id, "all", day(60));
ok(
    down.cumulativeReturn !== null && down.cumulativeReturn < 0,
    "negative return after a loss",
);

// A deposit must not change the return (flow-adjusted)
await h.deposit(
    "alice",
    1_000n * U,
    [{ poolKey: "liquid", bps: 10_000 }],
    10_000n * U,
    day(60),
);
const after = await computePerformance(db, alice.id, "all", day(60));
ok(
    Math.abs((after.cumulativeReturn ?? 0) - (down.cumulativeReturn ?? 0)) <
        1e-9,
    "deposit does not change return",
);

// Withdrawal must not change it either: covered by the same flow mechanism (recorded by markWithdrawalPaid).

// Snapshots and isolation
const snaps = await db
    .select()
    .from(s.userBalanceSnapshots)
    .where(eq(s.userBalanceSnapshots.userId, alice.id));
ok(snaps.length >= 2, "balance snapshots written per settlement");
const none = await computePerformance(db, bob.id, "all", day(60));
ok(none.points.length === 0, "user with no history has no points");

// Admin pool performance
const ap = await adminPerformance(db, "all", day(60));
ok(ap.pools.length === 5, "admin performance covers 5 pools");
ok(ap.lossUsd < 0n, "admin loss total recorded");
ok(ap.participantYieldUsd >= 0n, "admin yield total is non-negative");

await h.checkInvariants("history");
console.log("history ok");
process.exit(0);
