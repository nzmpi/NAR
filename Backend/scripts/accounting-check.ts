import { growthFactor } from "../src/accounting/rates.js";
import { P } from "../src/accounting/fixed.js";
import { emptyPools, totalAssets } from "../src/accounting/pools.js";
import {
    applyDeposit,
    applyMaturity,
    applyWithdrawal,
    quoteWithdrawal,
} from "../src/accounting/actions.js";
import { settle } from "../src/accounting/settle.js";

const U = 1_000_000n;
const YEAR = 365n * 86_400n;
const assert = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL " + m);
    console.log("ok  " + m);
};

// 1y factor == 1.10 exactly-ish
const f = growthFactor(1000, YEAR);
assert(
    1_100_000n * (P / 1_000_000n) - f < 10n ** 12n,
    "10% APY over 1y = 1.10",
);

let p = emptyPools();
p = applyDeposit(p, "manager", 10_000n * U).pools;
p = applyDeposit(p, "liquid", 1_000n * U).pools;
p = applyDeposit(p, "lock_3m", 1_000n * U).pools;
const t0 = 0n,
    t1 = YEAR;

// Profit: reported 12,500 on 12,000 -> caps 6%+10% of 1000 = 160 < 500
let r = settle({
    pools: p,
    reportedTotalUsd: 12_500n * U,
    intervalStart: t0,
    settledAt: t1,
});
assert(totalAssets(r.pools) === 12_500n * U, "positive: sum == reported");
assert(
    r.pools.liquid.assets >= 1_060n * U - 1n &&
        r.pools.liquid.assets <= 1_060n * U,
    "liquid +6%",
);
assert(r.pools.lock_3m.assets >= 1_099_999_000n, "3m +10%");
console.log("manager", r.pools.manager.assets);

// Bonus 100 to a 3m lot
const rb = settle({
    pools: p,
    reportedTotalUsd: 12_500n * U,
    intervalStart: t0,
    settledAt: t1,
    bonuses: [{ lotId: "L1", poolKey: "lock_3m", amountUsd: 100n * U }],
});
assert(totalAssets(rb.pools) === 12_500n * U, "bonus: sum == reported");
assert(
    rb.pools.lock_3m.assets === r.pools.lock_3m.assets + 100n * U,
    "bonus lands in 3m pool",
);

// Insufficient profit: scaled caps
const rs = settle({
    pools: p,
    reportedTotalUsd: 12_050n * U,
    intervalStart: t0,
    settledAt: t1,
});
assert(totalAssets(rs.pools) === 12_050n * U, "scaled caps, sum ok");
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
});
const e6 = r2.pools.liquid.assets - 1_000n * U,
    e8 = r2.pools.lock_1m.assets - 1_000n * U;
assert(
    e8 * 3n >= e6 * 4n - 4n && e8 * 3n <= e6 * 4n + 4n,
    "shortfall: 8% pool earns 4/3 of 6% pool",
);

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

// Maturity inside interval: 3m lot matured halfway -> earns less than full 10%
const half = YEAR / 2n;
const sh = p.lock_3m.shares;
const rm = settle({
    pools: p,
    reportedTotalUsd: 12_500n * U,
    intervalStart: t0,
    settledAt: t1,
    maturedLots: [{ poolKey: "lock_3m", shares: sh, maturesAt: half }],
});
assert(
    rm.pools.lock_3m.assets < r.pools.lock_3m.assets,
    "matured lot earns < full tier rate",
);
const cv = applyMaturity(rm.pools, "lock_3m", sh);
assert(
    totalAssets(cv.pools) === totalAssets(rm.pools) &&
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
console.log("all good");
