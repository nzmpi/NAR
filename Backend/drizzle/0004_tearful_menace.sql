-- Convert the existing pool entry to a pool asset debit.
UPDATE "ledger_entries"
SET
    "account_type" = 'pool_assets',
    "direction" = 'debit'
WHERE "account_type" = 'pool'
  AND "direction" = 'credit';

-- Add the matching user liability credit.
INSERT INTO "ledger_entries" (
    "id",
    "transaction_id",
    "account_type",
    "direction",
    "amount_usd",
    "created_at"
)
SELECT
    gen_random_uuid(),
    "transaction_id",
    'user_liability',
    'credit',
    "amount_usd",
    "created_at"
FROM "ledger_entries"
WHERE "account_type" = 'pool_assets'
  AND "direction" = 'debit';

ALTER TABLE "ledger_entries"
DROP CONSTRAINT "ledger_entries_asset_id_assets_id_fk";

ALTER TABLE "ledger_entries"
DROP CONSTRAINT "ledger_entries_user_id_users_id_fk";

ALTER TABLE "ledger_entries"
DROP COLUMN "asset_id";

ALTER TABLE "ledger_entries"
DROP COLUMN "user_id";

ALTER TABLE "ledger_entries"
DROP COLUMN "amount";