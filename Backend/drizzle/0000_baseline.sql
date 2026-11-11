CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"token_address" text NOT NULL,
	"decimals" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"chain_id" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chains_name_unique" UNIQUE("name"),
	CONSTRAINT "chains_chain_id_unique" UNIQUE("chain_id")
);
--> statement-breakpoint
CREATE TABLE "deposit_intent_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"share_bps" integer NOT NULL,
	CONSTRAINT "deposit_intent_alloc_bps" CHECK ("deposit_intent_allocations"."share_bps" > 0 AND "deposit_intent_allocations"."share_bps" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "deposit_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vault_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"chain_id" uuid NOT NULL,
	"token_address" text NOT NULL,
	"intended_amount" numeric(78, 0) NOT NULL,
	"status" text DEFAULT 'intent' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_amount" numeric(78, 0),
	"confirmed_amount_usd" numeric(78, 0),
	"user_approved_amount_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposit_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" uuid NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"vault_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"from_address" text,
	"amount" numeric(78, 0) NOT NULL,
	"block_number" numeric(78, 0),
	"block_timestamp" timestamp with time zone,
	"intent_id" uuid,
	"status" text DEFAULT 'detected' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"amount_usd" numeric(78, 0) NOT NULL,
	"sweep_tx_hash" text NOT NULL,
	"settlement_id" uuid,
	"confirmed_by_admin_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_intent_id_unique" UNIQUE("intent_id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_type" text NOT NULL,
	"pool_id" uuid,
	"user_id" uuid,
	"direction" text NOT NULL,
	"amount_usd" numeric(78, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_direction_ok" CHECK ("ledger_entries"."direction" IN ('debit','credit')),
	CONSTRAINT "ledger_amount_pos" CHECK ("ledger_entries"."amount_usd" > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"address" text NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_id" uuid NOT NULL,
	"total_assets_usd" numeric(78, 0) DEFAULT '0' NOT NULL,
	"total_shares" numeric(78, 0) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_states_pool_id_unique" UNIQUE("pool_id"),
	CONSTRAINT "pool_states_nonneg" CHECK ("pool_states"."total_assets_usd" >= 0 AND "pool_states"."total_shares" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"tier" integer,
	"projected_apy_bps" integer NOT NULL,
	"lock_months" integer DEFAULT 0 NOT NULL,
	"is_manager" boolean DEFAULT false NOT NULL,
	CONSTRAINT "pools_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "position_bonuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"position_lot_id" uuid NOT NULL,
	"amount_usd" numeric(78, 0) NOT NULL,
	"manager_shares_burned" numeric(78, 0) NOT NULL,
	"minted_shares" numeric(78, 0) NOT NULL,
	"granted_by_admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"shares" numeric(78, 0) NOT NULL,
	"reserved_shares" numeric(78, 0) DEFAULT '0' NOT NULL,
	"principal_usd" numeric(78, 0) DEFAULT '0' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"matures_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"parent_lot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_lots_shares_ok" CHECK ("position_lots"."shares" >= 0 AND "position_lots"."reserved_shares" >= 0 AND "position_lots"."reserved_shares" <= "position_lots"."shares")
);
--> statement-breakpoint
CREATE TABLE "settlement_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_usd" numeric(78, 0) NOT NULL,
	"nav_before_usd" numeric(78, 0) NOT NULL,
	"nav_after_usd" numeric(78, 0) NOT NULL,
	"shares_after" numeric(78, 0) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'manual' NOT NULL,
	"previous_total_assets_usd" numeric(78, 0) NOT NULL,
	"reported_total_assets_usd" numeric(78, 0) NOT NULL,
	"pnl_usd" numeric(78, 0) NOT NULL,
	"interval_start" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"admin_id" uuid,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" text NOT NULL,
	"username" text,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "vaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chain_id" uuid NOT NULL,
	"nonce" integer DEFAULT 0 NOT NULL,
	"address" text NOT NULL,
	"is_deployed" boolean DEFAULT false NOT NULL,
	"deploy_tx_hash" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawal_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"withdrawal_id" uuid NOT NULL,
	"position_lot_id" uuid NOT NULL,
	"shares" numeric(78, 0) NOT NULL,
	"gross_amount_usd" numeric(78, 0) NOT NULL,
	"early_fee_usd" numeric(78, 0) DEFAULT '0' NOT NULL,
	"net_payout_usd" numeric(78, 0) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"destination_address" text NOT NULL,
	"gross_amount_usd" numeric(78, 0) NOT NULL,
	"early_fee_usd" numeric(78, 0) DEFAULT '0' NOT NULL,
	"net_payout_usd" numeric(78, 0) NOT NULL,
	"payout_amount" numeric(78, 0) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"reviewed_by_admin_id" uuid,
	"reviewed_at" timestamp with time zone,
	"processed_by_admin_id" uuid,
	"processed_at" timestamp with time zone,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawals_paid_needs_tx" CHECK ("withdrawals"."status" <> 'paid' OR "withdrawals"."tx_hash" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_intent_allocations" ADD CONSTRAINT "deposit_intent_allocations_intent_id_deposit_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."deposit_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_intent_allocations" ADD CONSTRAINT "deposit_intent_allocations_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_intents" ADD CONSTRAINT "deposit_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_intents" ADD CONSTRAINT "deposit_intents_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_intents" ADD CONSTRAINT "deposit_intents_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_intents" ADD CONSTRAINT "deposit_intents_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_transfers" ADD CONSTRAINT "deposit_transfers_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_transfers" ADD CONSTRAINT "deposit_transfers_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_transfers" ADD CONSTRAINT "deposit_transfers_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_transfers" ADD CONSTRAINT "deposit_transfers_intent_id_deposit_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."deposit_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_intent_id_deposit_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."deposit_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_confirmed_by_admin_id_admins_id_fk" FOREIGN KEY ("confirmed_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_addresses" ADD CONSTRAINT "payout_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_states" ADD CONSTRAINT "pool_states_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_bonuses" ADD CONSTRAINT "position_bonuses_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_bonuses" ADD CONSTRAINT "position_bonuses_position_lot_id_position_lots_id_fk" FOREIGN KEY ("position_lot_id") REFERENCES "public"."position_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_bonuses" ADD CONSTRAINT "position_bonuses_granted_by_admin_id_admins_id_fk" FOREIGN KEY ("granted_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_lots" ADD CONSTRAINT "position_lots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_lots" ADD CONSTRAINT "position_lots_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_allocations" ADD CONSTRAINT "withdrawal_allocations_withdrawal_id_withdrawals_id_fk" FOREIGN KEY ("withdrawal_id") REFERENCES "public"."withdrawals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_allocations" ADD CONSTRAINT "withdrawal_allocations_position_lot_id_position_lots_id_fk" FOREIGN KEY ("position_lot_id") REFERENCES "public"."position_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_reviewed_by_admin_id_admins_id_fk" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_processed_by_admin_id_admins_id_fk" FOREIGN KEY ("processed_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_chain_address_unique" ON "assets" USING btree ("chain_id","token_address");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_intent_alloc_unique" ON "deposit_intent_allocations" USING btree ("intent_id","pool_id");--> statement-breakpoint
CREATE INDEX "deposit_intents_user_idx" ON "deposit_intents" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "deposit_intents_vault_idx" ON "deposit_intents" USING btree ("vault_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_transfers_identity_unique" ON "deposit_transfers" USING btree ("chain_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "deposit_transfers_intent_idx" ON "deposit_transfers" USING btree ("intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_scope_key_unique" ON "idempotency_keys" USING btree ("scope","key");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_addresses_unique" ON "payout_addresses" USING btree ("user_id","address");--> statement-breakpoint
CREATE INDEX "position_lots_user_idx" ON "position_lots" USING btree ("user_id","closed_at");--> statement-breakpoint
CREATE INDEX "position_lots_maturity_idx" ON "position_lots" USING btree ("matures_at");--> statement-breakpoint
CREATE INDEX "settlement_alloc_settlement_idx" ON "settlement_allocations" USING btree ("settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vaults_user_chain_nonce_unique" ON "vaults" USING btree ("user_id","chain_id","nonce");--> statement-breakpoint
CREATE UNIQUE INDEX "vaults_chain_address_unique" ON "vaults" USING btree ("chain_id","address");--> statement-breakpoint
CREATE INDEX "withdrawal_alloc_idx" ON "withdrawal_allocations" USING btree ("withdrawal_id");--> statement-breakpoint
CREATE INDEX "withdrawals_user_idx" ON "withdrawals" USING btree ("user_id","status");