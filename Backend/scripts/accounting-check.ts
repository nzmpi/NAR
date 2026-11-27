import { emptyPools, totalAssets } from "../src/accounting/pools.js";
import {
    applyDeposit,
    applyMaturity,
    quoteWithdrawal,
    type WithdrawalQuote,
} from "../src/accounting/actions.js";
import { burn, clonePools } from "../src/accounting/pools.js";
import { type PoolKey } from "../src/accounting/pools.js";
import {
    capAllowanceUsd,
    settle,
    type LotInput,
} from "../src/accounting/settle.js";

const U = 1_000_000n;

// Pays out a quoted withdrawal: the fee stays in the manager pool. (Test-only: production pays via markWithdrawalPaid.)
// Execute at payment/reservation time. Fee stays in system as manager NAV.
function applyWithdrawal(pools: Pools, poolKey: PoolKey, q: WithdrawalQuote) {
    const p = clonePools(pools);
    const b = burn(p[poolKey], q.sharesBurned);
    p[poolKey] = b.state;
    p.manager.assets += q.feeUsd; // no shares minted
    return { pools: p, paidOutUsd: q.netUsd };
}

const YEAR = 365n * 86_400n;
const assert = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL " + m);
    console.log("ok  " + m);
};

let p = emptyPools();
p = applyDeposit(p, "manager", 10_000n * U).pools;
p = applyDeposit(p, "liquid", 1_000n * U).pools;
p = applyDeposit(p, "lock_3m", 1_000n * U).pools;
const t0 = 0n,
    t1 = YEAR;
const lots = (capL = 60n * U, capK = 100n * U): LotInput[] => [
    {
        lotId: "L",
        poolKey: "liquid",
        shares: p.liquid.shares,
        apyBps: 600,
        capLeftUsd: capL,
    },
    {
        lotId: "K",
        poolKey: "lock_3m",
        shares: p.lock_3m.shares,
        apyBps: 1000,
        capLeftUsd: capK,
    },
];
const near = (a: bigint, b: bigint) => a - b <= 2n && b - a <= 2n;
const credit = (
    r: { lotCredits: { lotId: string; amountUsd: bigint }[] },
    id: string,
) => r.lotCredits.find((c) => c.lotId === id)?.amountUsd ?? 0n;

// Profit 500 on 12,000: manager takes its NAV share (10/12), users split the
// rest by value * APY (6:10), both under their yearly caps.
let r = settle({
    pools: p,
    reportedTotalUsd: 12_500n * U,
    intervalStart: t0,
    settledAt: t1,
    lots: lots(),
});
assert(totalAssets(r.pools) === 12_500n * U, "positive: sum == reported");
const users = 500n * U - (500n * U * 10n) / 12n;
assert(
    near(credit(r, "L"), (users * 6n) / 16n),
    "liquid gets 6/16 of user part",
);
assert(near(credit(r, "K"), (users * 10n) / 16n), "3m gets 10/16 of user part");
assert(
    r.pools.liquid.assets === 1_000n * U + credit(r, "L"),
    "lot credit lands in its pool",
);

// Over cap: 3m lot has 10 left of its yearly cap -> 10 + 1/10 of the rest
const rc = settle({
    pools: p,
    reportedTotalUsd: 12_500n * U,
    intervalStart: t0,
    settledAt: t1,
    lots: lots(60n * U, 10n * U),
});
const k = (users * 10n) / 16n;
assert(
    near(credit(rc, "K"), 10n * U + (k - 10n * U) / 10n),
    "over cap: full share up to cap, then 1/10",
);
assert(totalAssets(rc.pools) === 12_500n * U, "over cap: sum == reported");
assert(
    rc.pools.manager.assets > r.pools.manager.assets,
    "over-cap remainder goes to manager",
);

// User's example: users 1,000 and manager 1,000, profit 10 -> 5 each
let h = emptyPools();
h = applyDeposit(h, "manager", 1_000n * U).pools;
h = applyDeposit(h, "liquid", 1_000n * U).pools;
const rh = settle({
    pools: h,
    reportedTotalUsd: 2_010n * U,
    intervalStart: 0n,
    settledAt: 86_400n,
    lots: [
        {
            lotId: "L",
            poolKey: "liquid",
            shares: h.liquid.shares,
            apyBps: 600,
            capLeftUsd: 60n * U,
        },
    ],
});
assert(credit(rh, "L") === 5n * U, "50/50 split: users 5");
assert(rh.pools.manager.assets === 1_005n * U, "50/50 split: manager 5");

// Bonus 100 to a 3m lot
const rb = settle({
    pools: p,
    reportedTotalUsd: 12_500n * U,
    intervalStart: t0,
    settledAt: t1,
    lots: lots(),
    bonuses: [{ lotId: "K", poolKey: "lock_3m", amountUsd: 100n * U }],
});
assert(totalAssets(rb.pools) === 12_500n * U, "bonus: sum == reported");
assert(
    rb.pools.lock_3m.assets === r.pools.lock_3m.assets + 100n * U,
    "bonus lands in 3m pool",
);

// 8% vs 6% pools, equal NAV: earnings ratio must be 4/3
let q2 = emptyPools();
q2 = applyDeposit(q2, "manager", 1_000n * U).pools;
q2 = applyDeposit(q2, "liquid", 1_000n * U).pools;
q2 = applyDeposit(q2, "lock_1m", 1_000n * U).pools;
const r2 = settle({
    pools: q2,
    reportedTotalUsd: 3_010n * U,
    intervalStart: 0n,
    settledAt: YEAR,
    lots: [
        {
            lotId: "A",
            poolKey: "liquid",
            shares: q2.liquid.shares,
            apyBps: 600,
            capLeftUsd: 60n * U,
        },
        {
            lotId: "B",
            poolKey: "lock_1m",
            shares: q2.lock_1m.shares,
            apyBps: 800,
            capLeftUsd: 80n * U,
        },
    ],
});
const e6 = credit(r2, "A"),
    e8 = credit(r2, "B");
assert(
    e8 * 3n >= e6 * 4n - 4n && e8 * 3n <= e6 * 4n + 4n,
    "8% lot earns 4/3 of 6% lot",
);

// No user lots: all profit to manager
const rn = settle({
    pools: p,
    reportedTotalUsd: 12_500n * U,
    intervalStart: t0,
    settledAt: t1,
});
assert(rn.pools.manager.assets === 10_500n * U, "no lots: manager gets all");

// Loss: same % everywhere
const rl = settle({
    pools: p,
    reportedTotalUsd: 10_800n * U,
    intervalStart: t0,
    settledAt: t1,
});
assert(totalAssets(rl.pools) === 10_800n * U, "loss: sum == reported");
assert(rl.pools.liquid.assets === 900n * U, "loss: liquid -10%");
assert(rl.pools.manager.assets === 9_000n * U, "loss: manager -10%");

// Maturity conversion conserves NAV
const cv = applyMaturity(r.pools, "lock_3m", r.pools.lock_3m.shares);
assert(
    totalAssets(cv.pools) === totalAssets(r.pools) &&
        cv.pools.lock_3m.assets === 0n,
    "maturity conserves NAV",
);

// Early withdrawal 400 -> 360 + 40 fee
const q = quoteWithdrawal(p, "lock_3m", p.lock_3m.shares, 400n * U, true);
assert(
    q.netUsd === 360n * U && q.feeUsd === 40n * U,
    "early fee 400 -> 360/40",
);
const w = applyWithdrawal(p, "lock_3m", q);
assert(
    totalAssets(w.pools) === totalAssets(p) - 360n * U,
    "withdrawal: NAV drops by net only",
);

// Weekly cap with carry-over: 1,000 at 6% -> 60/yr, 60 * 7/365 per started week.
const D = 86_400n;
const week = (60n * U * 7n) / 365n; // 1.150684 USD
assert(
    capAllowanceUsd(1_000n * U, 600, 0n) === week,
    "cap: week 1 opens 7/365",
);
assert(
    capAllowanceUsd(1_000n * U, 600, 7n * D - 1n) === week,
    "cap: same week",
);
assert(
    capAllowanceUsd(1_000n * U, 600, 7n * D) === (60n * U * 14n) / 365n,
    "cap: week 2 adds another 7/365",
);
assert(
    capAllowanceUsd(1_000n * U, 600, 364n * D) === 60n * U,
    "cap: full year by the last day",
);
// Half of week 1 used -> week 2 has 1.5 weeks of room.
const used = week / 2n;
assert(
    capAllowanceUsd(1_000n * U, 600, 8n * D) - used ===
        (60n * U * 14n) / 365n - week / 2n,
    "cap: unused week-1 room carries into week 2",
);
console.log("accounting ok");
