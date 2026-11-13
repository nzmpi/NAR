import { ledgerEntries, ledgerTransactions } from "../db/schema.js";
import type { Tx } from "./types.js";

export interface LedgerLine {
    account: "managed_funds" | "pool_equity";
    direction: "debit" | "credit";
    amountUsd: bigint;
    poolId?: string;
    userId?: string;
}

// Double-entry: debits must equal credits. Zero lines are skipped.
export async function postLedger(
    tx: Tx,
    t: {
        type: string;
        referenceType: string;
        referenceId: string;
        adminId?: string | null;
        lines: LedgerLine[];
    },
) {
    const lines = t.lines.filter((l) => l.amountUsd !== 0n);
    if (lines.some((l) => l.amountUsd < 0n))
        throw new Error("ledger: negative line");
    const sum = (d: string) =>
        lines
            .filter((l) => l.direction === d)
            .reduce((s, l) => s + l.amountUsd, 0n);
    if (sum("debit") !== sum("credit"))
        throw new Error("ledger: unbalanced transaction");
    if (lines.length === 0) return null;

    const [row] = await tx
        .insert(ledgerTransactions)
        .values({
            type: t.type,
            referenceType: t.referenceType,
            referenceId: t.referenceId,
            createdByAdminId: t.adminId ?? null,
        })
        .returning({ id: ledgerTransactions.id });

    await tx.insert(ledgerEntries).values(
        lines.map((l) => ({
            transactionId: row.id,
            accountType: l.account,
            poolId: l.poolId ?? null,
            userId: l.userId ?? null,
            direction: l.direction,
            amountUsd: l.amountUsd.toString(),
        })),
    );
    return row.id as string;
}
