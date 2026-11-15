import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as s from "../../src/db/schema.js";
import {
    activateDeposit,
    autoMatchTransfer,
    createIntent,
    recordSweep,
    recordTransfer,
} from "../../src/services/depositIntents.js";

export const U = 1_000_000n;
export const T0 = new Date("2026-01-01T00:00:00Z");
export const day = (d: number) => new Date(T0.getTime() + d * 86_400_000);

export const ok = (c: unknown, m: string) => {
    if (!c) throw new Error("FAIL " + m);
    console.log("ok  " + m);
};
export const rejects = async (p: Promise<unknown>, m: string) => {
    try {
        await p;
    } catch {
        return console.log("ok  " + m);
    }
    throw new Error("FAIL (no error) " + m);
};

// Fresh in-memory Postgres with all migrations, plus a manager, two users,
// an admin, one chain and USDC. No network, no DATABASE_URL needed.
export async function setup() {
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

    const [mgr] = await db
        .insert(s.users)
        .values({ telegramId: "1", username: "mgr" })
        .returning();
    const [alice] = await db
        .insert(s.users)
        .values({ telegramId: "2" })
        .returning();
    const [bob] = await db
        .insert(s.users)
        .values({ telegramId: "3" })
        .returning();
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
    const mkVault = async (userId: string, address: string) =>
        (
            await db
                .insert(s.vaults)
                .values({
                    userId,
                    chainId: chain.id,
                    address,
                    isDeployed: true,
                })
                .returning()
        )[0];
    const vaults = {
        mgr: await mkVault(mgr.id, "0xm"),
        alice: await mkVault(alice.id, "0xa"),
        bob: await mkVault(bob.id, "0xb"),
    };

    let n = 0;
    const hash = () => "0x" + (++n).toString(16).padStart(64, "0");

    // Full deposit path: intent -> transfer -> match -> sweep -> activate.
    // totalBefore = operator-reported total NAV before this deposit's funds.
    async function deposit(
        who: "mgr" | "alice" | "bob",
        amount: bigint,
        allocations: { poolKey: any; bps: number }[],
        totalBefore: bigint,
        now: Date,
    ) {
        const user = { mgr, alice, bob }[who];
        const vault = vaults[who];
        const intent = await createIntent(db, {
            userId: user.id,
            vaultId: vault.id,
            assetId: usdc.id,
            intendedAmount: amount,
            allocations,
            now,
        });
        const t = await recordTransfer(db, {
            vaultId: vault.id,
            assetId: usdc.id,
            txHash: hash(),
            logIndex: 0,
            amount,
        });
        await autoMatchTransfer(db, t.id, now);
        await recordSweep(db, {
            intentId: intent.id,
            adminId: admin.id,
            sweepTxHash: hash(),
            now,
        });
        await activateDeposit(db, {
            intentId: intent.id,
            adminId: admin.id,
            reportedTotalUsd: totalBefore,
            now,
        });
        return intent.id as string;
    }

    async function openLots(userId: string) {
        const rows = await db
            .select({
                id: s.positionLots.id,
                key: s.pools.key,
                shares: s.positionLots.shares,
                reserved: s.positionLots.reservedShares,
                maturesAt: s.positionLots.maturesAt,
            })
            .from(s.positionLots)
            .innerJoin(s.pools, eq(s.pools.id, s.positionLots.poolId))
            .where(
                and(
                    eq(s.positionLots.userId, userId),
                    isNull(s.positionLots.closedAt),
                ),
            );
        return rows.map((r) => ({
            ...r,
            shares: BigInt(r.shares),
            reserved: BigInt(r.reserved),
        }));
    }

    async function totalNav() {
        const rows = await db
            .select({ a: s.poolStates.totalAssetsUsd })
            .from(s.poolStates);
        return rows.reduce((x, y) => x + BigInt(y.a), 0n);
    }

    // Shares of open lots == pool shares; every ledger transaction balances.
    async function checkInvariants(label: string) {
        const states = await db
            .select({ key: s.pools.key, sh: s.poolStates.totalShares })
            .from(s.poolStates)
            .innerJoin(s.pools, eq(s.pools.id, s.poolStates.poolId));
        for (const st of states) {
            const r: any = await db.execute(
                sql`select coalesce(sum(shares),0)::text as v from position_lots where closed_at is null and pool_id = (select id from pools where key=${st.key})`,
            );
            ok(
                BigInt(r.rows[0].v) === BigInt(st.sh),
                `${label}: lot shares == pool shares (${st.key})`,
            );
        }
        const bad: any = await db.execute(
            sql`select transaction_id from ledger_entries group by transaction_id having sum(case when direction='debit' then amount_usd else -amount_usd end) <> 0`,
        );
        ok(bad.rows.length === 0, `${label}: ledger balances`);
    }

    return {
        db,
        s,
        mgr,
        alice,
        bob,
        admin,
        chain,
        usdc,
        vaults,
        hash,
        deposit,
        openLots,
        totalNav,
        checkInvariants,
    };
}
