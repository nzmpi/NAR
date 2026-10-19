BEGIN;

-- Add the matching user liability credit.
-- The old columns still exist, so provide valid values for them.
INSERT INTO ledger_entries (
    transaction_id,
    asset_id,
    account_type,
    user_id,
    direction,
    amount,
    amount_usd
)
SELECT
    transaction_id,
    asset_id,
    'user_liability',
    user_id,
    'credit',
    amount,
    amount_usd
FROM ledger_entries
WHERE account_type = 'pool_assets'
  AND direction = 'debit'
  AND transaction_id = 'c03c859b-edf9-41b5-88ab-1af016716c58';

-- Remove token-specific foreign keys.
ALTER TABLE ledger_entries
DROP CONSTRAINT ledger_entries_asset_id_assets_id_fk;

ALTER TABLE ledger_entries
DROP CONSTRAINT ledger_entries_user_id_users_id_fk;

-- Remove token-specific columns.
ALTER TABLE ledger_entries
DROP COLUMN asset_id;

ALTER TABLE ledger_entries
DROP COLUMN user_id;

ALTER TABLE ledger_entries
DROP COLUMN amount;

COMMIT;