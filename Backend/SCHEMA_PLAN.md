# Five-pool accounting schema plan

This replaces the prototype's singleton `pool_states` row and one `user_positions` row per user. It is a schema draft only; it does not change the running backend.

## Scope

The five pools are `liquid`, `lock_1m`, `lock_2m`, `lock_3m`, and `manager`.

Participant pools have projected compounded APYs of 6%, 8%, 9%, and 10%. The manager pool receives excess positive performance, early-withdrawal fees, and manager deposits. It bears the same percentage loss as every other pool.

All money values are integer USD micro-units and all shares are 18-decimal fixed-point integers. Do not use JavaScript floating-point values for either.

## Replace or add tables

| Table | Purpose | Essential fields |
| --- | --- | --- |
| `pools` | Static definition of the five pools. | `id`, `key` (unique), `projected_apy_bps`, `lock_duration_seconds`, `is_manager` |
| `pool_states` | One current NAV/share state per pool. Replaces the singleton row. | `pool_id` (unique), `total_assets_usd`, `total_shares`, `updated_at` |
| `position_lots` | A user's independently maturing stake. Replaces `user_positions`. | `id`, `user_id`, `pool_id`, `shares`, `opened_at`, `matures_at`, `closed_at`, `source_type` |
| `settlements` | Immutable manual total-NAV entry. | `id`, `reported_total_assets_usd`, `previous_total_assets_usd`, `pnl_usd`, `settled_at`, `admin_id` |
| `settlement_allocations` | Auditable allocation of every settlement among pools. | `id`, `settlement_id`, `pool_id`, `kind`, `amount_usd` |
| `position_bonuses` | One-time manager-funded bonus for an individual lot. | `id`, `settlement_id`, `position_lot_id`, `amount_usd`, `minted_shares`, `granted_by_admin_id` |
| `withdrawal_allocations` | Locks a withdrawal request to the exact liquid or locked lot shares it consumes. | `id`, `withdrawal_id`, `position_lot_id`, `shares`, `gross_amount_usd`, `early_fee_usd`, `net_payout_usd` |

Keep the existing users, admins, chains, assets, vaults, deposits, withdrawals, ledger, idempotency, and audit tables. Extend `deposits` with its selected pool and the confirmed lot it created. Extend `withdrawals` with `gross_amount_usd`, `early_fee_usd`, `net_payout_usd`, and a rejection reason.

`pools` should be seeded once with the five fixed entries. It is not an admin-editable rate table in the first release.

## Settlement transaction

Every balance-changing action first settles at server time in one database transaction.

1. Sum the five current pool NAVs and compare it to the operator's reported current total NAV.
2. When the delta is negative, multiply every pool NAV by the same loss ratio. Leave shares unchanged.
3. When the delta is positive, calculate each participant pool's compounded projected-APY amount for its time-weighted exposure during the interval. A lot that matures inside the interval earns its lock rate until maturity and the liquid rate afterward.
4. Credit participant pools up to those default amounts. Credit all remaining positive value to the manager pool.
5. Apply approved one-time lot bonuses by transferring value from the manager pool and minting shares only for the selected lot at the participant pool's current price. Reject an allocation that exceeds manager excess or would make the total allocation larger than the reported delta.
6. Record the settlement, its allocations, balanced ledger entries, and audit log together.

The resulting five pool NAVs must equal the reported total NAV exactly after rounding. Do not backdate settlements or edit them; corrections are new settlements.

## Position flows

- **Confirmed deposit:** mint shares in each selected participant pool and create one lot per split. Adding funds to an active lock always creates a new full-duration lot.
- **Maturity:** burn the matured lot's locked-pool shares and mint liquid-pool shares for its current value. The lock does not renew.
- **Relock:** burn selected liquid shares and create one or more new lock lots. Max uses all available current value. Extending an active lock creates a new longer-tier lot.
- **Withdrawal:** liquid value is consumed first. For active locks, burn shares equal to the requested gross current value, reserve the net payout, and credit 10% of that gross value to the manager pool. A 400 USD early withdrawal pays 360 USD and credits 40 USD to the manager pool.
- **Manager movement:** manager deposits mint manager shares at the current price. Manager withdrawals burn manager shares. Excess performance and early fees add manager NAV without minting shares.

## Migration approach

The current migration history is already inconsistent and the backend is a prototype. Before any funded deployment, replace the initial singleton pool migration sequence with a clean baseline that creates the tables above and seeds the five pools. Do not run a destructive baseline rewrite against a database holding real user funds; write an explicit data migration for that case.

Keep all writes transactional, lock the affected pool-state rows during calculations, and retain ledger and audit records for every movement.
