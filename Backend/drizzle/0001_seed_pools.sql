-- Five fixed pools. Rates are projected compounded APYs in basis points.
INSERT INTO "pools" ("key", "label", "tier", "projected_apy_bps", "lock_months", "is_manager") VALUES
  ('liquid',  'Liquid',  0, 600,  0, false),
  ('lock_1m', '1 month', 1, 800,  1, false),
  ('lock_2m', '2 months',2, 900,  2, false),
  ('lock_3m', '3 months',3, 1000, 3, false),
  ('manager', 'Manager', NULL, 0, 0, true);
--> statement-breakpoint
INSERT INTO "pool_states" ("pool_id") SELECT "id" FROM "pools";
