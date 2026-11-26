import { previewSettlement, settleManual } from "../src/services/settlement.js";
import { readPools } from "../src/services/queries.js";
import { U, day, ok, rejects, setup } from "./lib/harness.js";

const h = await setup();
const { db, s, alice, admin } = h;

await h.deposit(
    "mgr",
    10_000n * U,
    [{ poolKey: "manager", bps: 10_000 }],
    0n,
    day(0),
);
// Half in a 1-month lock that matures before the settlement below.
await h.deposit(
    "alice",
    1_000n * U,
    [
        { poolKey: "liquid", bps: 5_000 },
        { poolKey: "lock_1m", bps: 5_000 },
    ],
    10_000n * U,
    day(0),
);
const lot = (await h.openLots(alice.id)).find((l) => l.key === "liquid")!;
const snapshot = async () =>
    JSON.stringify({
        pools: Object.fromEntries(
            Object.entries((await readPools(db)).state).map(([k, v]) => [
                k,
                v.assets.toString() + "/" + v.shares.toString(),
            ]),
        ),
        settlements: (await db.select().from(s.settlements)).length,
        ledger: (await db.select().from(s.ledgerTransactions)).length,
        audit: (await db.select().from(s.auditLogs)).length,
        lots: (await db.select().from(s.positionLots))
            .map((l) => `${l.id}:${l.shares}:${l.capUsedUsd}`)
            .sort(),
    });

const input = {
    adminId: admin.id,
    reportedTotalUsd: 11_100n * U,
    bonuses: [{ lotId: lot.id, amountUsd: 5n * U }],
    now: day(40),
};
const before = await snapshot();
const p = await previewSettlement(db, input);
ok((await snapshot()) === before, "preview saves nothing");
ok(p.pnlUsd === String(100n * U), "preview shows the profit");
ok(p.previousTotalUsd === String(11_000n * U), "preview shows the last total");
ok(
    p.bonuses.length === 1 && p.bonuses[0].amountUsd === String(5n * U),
    "preview lists the bonus",
);
ok(p.lotsCredited === 2, "preview counts the credited lots");
ok(p.maturedLots === 1, "preview counts the matured lock");
ok(
    p.pools.find((x) => x.pool === "lock_1m")!.afterUsd === "0",
    "matured lock shows 0 after (moved to Liquid)",
);

await rejects(
    previewSettlement(db, { ...input, reportedTotalUsd: 20_000n * U }),
    "preview applies the large-change check",
);

// Confirm with the same input records exactly what the preview showed.
await settleManual(db, input);
const after = (await readPools(db)).state;
ok(
    p.pools.every(
        (x) =>
            after[x.pool as keyof typeof after].assets.toString() ===
            x.afterUsd,
    ),
    "recorded pool values match the preview",
);
ok(
    p.pools.reduce((t, x) => t + BigInt(x.afterUsd), 0n) === 11_100n * U,
    "preview pool values add up to the reported total",
);
console.log("settlement preview checks passed");
