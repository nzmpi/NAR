import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as s from "../src/db/schema.js";
import {
    activateDeposit,
    approveAmount,
    autoMatchTransfer,
    createIntent,
    recordSweep,
    recordTransfer,
} from "../src/services/depositIntents.js";
import { settleManual } from "../src/services/settlement.js";
import { adminListUsers, getPortfolio } from "../src/services/queries.js";

const U = 1_000_000n;
const ok = (c: unknown, m: string) => {
    if (!c) throw new Error("FAIL " + m);
    console.log("ok  " + m);
};
const rejects = async (p: Promise<unknown>, m: string) => {
    try {
        await p;
    } catch {
        return console.log("ok  " + m);
    }
    throw new Error("FAIL (no error) " + m);
};

const client = new PGlite();
const db = drizzle(client);
for (const f of fs
    .readdirSync("drizzle")
    .filter((x: string) => x.endsWith(".sql"))
    .sort())
    for (const st of fs
        .readFileSync("drizzle/" + f, "utf8")
        .split("--> statement-breakpoint"))
        if (st.trim()) await client.exec(st);

const [adminUser] = await db
    .insert(s.users)
    .values({ telegramId: "1", username: "mgr" })
    .returning();
const [alice] = await db
    .insert(s.users)
    .values({ telegramId: "2" })
    .returning();
const [bob] = await db.insert(s.users).values({ telegramId: "3" }).returning();
const [admin] = await db
    .insert(s.admins)
    .values({ telegramId: "1" })
    .returning();
const [chain] = await db
    .insert(s.chains)
    .values({ name: "Polygon", chainId: 137 })
    .returning();
const [usdc] = await db
    .insert(s.assets)
    .values({
        chainId: chain.id,
        symbol: "USDC",
        name: "USDC",
        tokenAddress: "0xusdc",
        decimals: 6,
    })
    .returning();
const [dai] = await db
    .insert(s.assets)
    .values({
        chainId: chain.id,
        symbol: "DAI",
        name: "DAI",
        tokenAddress: "0xdai",
        decimals: 18,
    })
    .returning();
const mkVault = async (u: string, a: string) =>
    (
        await db
            .insert(s.vaults)
            .values({
                userId: u,
                chainId: chain.id,
                address: a,
                isDeployed: true,
            })
            .returning()
    )[0];
const vM = await mkVault(adminUser.id, "0xm"),
    vA = await mkVault(alice.id, "0xa"),
    vB = await mkVault(bob.id, "0xb");

let n = 0;
const hash = () => "0x" + (++n).toString(16).padStart(64, "0");
const T0 = new Date("2026-01-01T00:00:00Z");
const day = (d: number) => new Date(T0.getTime() + d * 86_400_000);

async function fullDeposit(
    userId: string,
    vaultId: string,
    assetId: string,
    intended: bigint,
    allocations: { poolKey: any; bps: number }[],
    total: bigint,
    now: Date,
    sent = intended,
) {
    const intent = await createIntent(db, {
        userId,
        vaultId,
        assetId,
        intendedAmount: intended,
        allocations,
        now,
    });
    const t = await recordTransfer(db, {
        vaultId,
        assetId,
        txHash: hash(),
        logIndex: 0,
        amount: sent,
    });
    const m = await autoMatchTransfer(db, t.id, now);
    ok(m.matched, "auto-match single open intent");
    const sw = await recordSweep(db, {
        intentId: intent.id,
        adminId: admin.id,
        sweepTxHash: hash(),
        now,
    });
    return {
        intent,
        sw,
        activate: () =>
            activateDeposit(db, {
                intentId: intent.id,
                adminId: admin.id,
                reportedTotalUsd: total,
                confirmLargeMove: true,
                now,
            }),
    };
}

// Manager first: 10,000 USDC into manager pool
let d = await fullDeposit(
    adminUser.id,
    vM.id,
    usdc.id,
    10_000n * U,
    [{ poolKey: "manager", bps: 10_000 }],
    0n,
    T0,
);
ok(d.sw.status === "ready_to_activate", "exact amount -> ready_to_activate");
await d.activate();

// Alice 1,000 USDC: 50% liquid / 50% 3-month
d = await fullDeposit(
    alice.id,
    vA.id,
    usdc.id,
    1_000n * U,
    [
        { poolKey: "liquid", bps: 5000 },
        { poolKey: "lock_3m", bps: 5000 },
    ],
    10_000n * U,
    T0,
);
await d.activate();

// Non-manager cannot use manager pool; minimum enforced
await rejects(
    createIntent(db, {
        userId: alice.id,
        vaultId: vA.id,
        assetId: usdc.id,
        intendedAmount: 100n * U,
        allocations: [{ poolKey: "manager", bps: 10_000 }],
        now: T0,
    }),
    "non-manager blocked from manager pool",
);
await rejects(
    createIntent(db, {
        userId: alice.id,
        vaultId: vA.id,
        assetId: usdc.id,
        intendedAmount: 10n * U,
        allocations: [{ poolKey: "liquid", bps: 10_000 }],
        now: T0,
    }),
    "below 50 USD minimum rejected",
);
// Duplicate transfer identity
const h = hash();
await recordTransfer(db, {
    vaultId: vB.id,
    assetId: usdc.id,
    txHash: h,
    logIndex: 1,
    amount: 5n * U,
});
await rejects(
    recordTransfer(db, {
        vaultId: vB.id,
        assetId: usdc.id,
        txHash: h.toUpperCase().replace("0X", "0x"),
        logIndex: 1,
        amount: 5n * U,
    }),
    "duplicate chain+tx+logIndex rejected",
);
await db
    .update(s.depositTransfers)
    .set({ status: "rejected" })
    .where(eq(s.depositTransfers.txHash, h));

// Bob DAI intent 100, sends 90 -> needs user approval
const bobIntent = await createIntent(db, {
    userId: bob.id,
    vaultId: vB.id,
    assetId: dai.id,
    intendedAmount: 100n * 10n ** 18n,
    allocations: [{ poolKey: "lock_1m", bps: 10_000 }],
    now: day(10),
});
const bt = await recordTransfer(db, {
    vaultId: vB.id,
    assetId: dai.id,
    txHash: hash(),
    logIndex: 0,
    amount: 90n * 10n ** 18n,
});
await autoMatchTransfer(db, bt.id, day(10));
await rejects(
    recordSweep(db, {
        intentId: bobIntent.id,
        adminId: admin.id,
        sweepTxHash: hash(),
        sweptAmount: 89n * 10n ** 18n,
        now: day(10),
    }),
    "confirmed amount above what the sweep moved rejected",
);
const sw = await recordSweep(db, {
    intentId: bobIntent.id,
    adminId: admin.id,
    sweepTxHash: hash(),
    now: day(10),
});
ok(
    sw.status === "awaiting_user_approval",
    "amount mismatch -> awaiting_user_approval",
);
await rejects(
    activateDeposit(db, {
        intentId: bobIntent.id,
        adminId: admin.id,
        reportedTotalUsd: 11_000n * U,
        confirmLargeMove: true,
        now: day(10),
    }),
    "cannot activate before user approval",
);
await approveAmount(db, {
    intentId: bobIntent.id,
    userId: bob.id,
    now: day(10),
});
// NAV grew: 11,000 before Bob's money. Activate at day 10.
await activateDeposit(db, {
    intentId: bobIntent.id,
    adminId: admin.id,
    reportedTotalUsd: 11_050n * U,
    confirmLargeMove: true,
    now: day(10),
});

// One year later (Alice's 3m lot matured): operator reports 12,500; bonus 20 USD to Bob's 1m lot
const [bobLot] = await db
    .select()
    .from(s.positionLots)
    .where(eq(s.positionLots.userId, bob.id));
const r = await settleManual(db, {
    adminId: admin.id,
    reportedTotalUsd: 12_500n * U,
    confirmLargeMove: true,
    now: day(365),
    bonuses: [{ lotId: bobLot.id, amountUsd: 20n * U }],
});
ok(r.convertedLots.length >= 1, "matured Alice 3m lot converted to liquid");

// Invariants
const states = await db
    .select({
        key: s.pools.key,
        a: s.poolStates.totalAssetsUsd,
        sh: s.poolStates.totalShares,
    })
    .from(s.poolStates)
    .innerJoin(s.pools, eq(s.pools.id, s.poolStates.poolId));
const totalNav = states.reduce((x, y) => x + BigInt(y.a), 0n);
ok(totalNav === 12_500n * U, "sum of pool NAVs == reported total");
for (const st of states) {
    const [{ v }] = await db
        .execute(
            sql`select coalesce(sum(shares),0)::text as v from position_lots where closed_at is null and pool_id = (select id from pools where key=${st.key})`,
        )
        .then((x: any) => x.rows);
    ok(
        BigInt(v) === BigInt(st.sh),
        `lot shares sum == pool shares (${st.key})`,
    );
}
const bad = await db.execute(
    sql`select transaction_id from ledger_entries group by transaction_id having sum(case when direction='debit' then amount_usd else -amount_usd end) <> 0`,
);
ok((bad as any).rows.length === 0, "every ledger transaction balances");
const [{ c }] = (
    (await db.execute(sql`select count(*)::int c from position_bonuses`)) as any
).rows;
ok(c === 1, "bonus recorded");
const [{ a }] = (
    (await db.execute(sql`select count(*)::int a from audit_logs`)) as any
).rows;
ok(a > 5, "audit log written");
await rejects(
    settleManual(db, {
        adminId: admin.id,
        reportedTotalUsd: 12_500n * U,
        confirmLargeMove: true,
        now: day(100),
    }),
    "backdated settlement rejected",
);
await rejects(
    settleManual(db, {
        adminId: admin.id,
        reportedTotalUsd: 1_250n * U,
        now: day(366),
    }),
    ">10% NAV move rejected without confirmation",
);
await settleManual(db, {
    adminId: admin.id,
    reportedTotalUsd: 12_600n * U,
    now: day(366),
});
ok(true, "<10% NAV move needs no confirmation");
{
    // Bob's open lot (his 1m lot matured into liquid at day 365).
    const lotNow = async () =>
        (
            await db
                .select()
                .from(s.positionLots)
                .where(
                    and(
                        eq(s.positionLots.userId, bob.id),
                        isNull(s.positionLots.closedAt),
                    ),
                )
        )[0];
    const l1 = await lotNow();
    ok(
        l1.capBaseUsd !== null && BigInt(l1.capUsedUsd) > 0n,
        "settlement records the lot's yearly cap use",
    );
    await settleManual(db, {
        adminId: admin.id,
        reportedTotalUsd: 12_700n * U,
        now: day(1_100),
    });
    const l2 = await lotNow();
    const years =
        (l2.capYearStart!.getTime() - l2.openedAt.getTime()) /
        (365 * 86_400_000);
    ok(years === 2, "cap year advances by whole lot-years");
    ok(
        BigInt(l2.capUsedUsd) <= (BigInt(l2.capBaseUsd!) * 600n) / 10_000n,
        "cap use reset at the anniversary",
    );
}
{
    const listed = await adminListUsers(db);
    ok(
        listed.some((x) => x.balanceUsd > 0n),
        "user list has a non-zero balance",
    );
    for (const u of [alice, bob]) {
        const row = listed.find((x) => x.id === u.id)!;
        const pf = await getPortfolio(db, u.id);
        ok(
            row.balanceUsd === pf.totalBalanceUsd,
            `user list balance matches portfolio (tg ${u.telegramId})`,
        );
    }
    // Same address (nonce 0) on a second chain is still one vault.
    const [chain2] = await db
        .insert(s.chains)
        .values({ name: "Base", chainId: 8453 })
        .returning();
    await db.insert(s.vaults).values({
        userId: alice.id,
        chainId: chain2.id,
        address: "0xa",
        isDeployed: false,
    });
    const again = await adminListUsers(db);
    ok(
        again.find((x) => x.id === alice.id)!.vaultCount === 1,
        "vault count is per address, not per chain",
    );
    ok(
        again.find((x) => x.id === bob.id)!.vaultCount === 1,
        "user with one vault counts one",
    );
    ok(
        again.find((x) => x.id === adminUser.id)!.isAdmin &&
            !again.find((x) => x.id === alice.id)!.isAdmin,
        "user list flags admin accounts",
    );
}
console.log("integration ok");
process.exit(0);
