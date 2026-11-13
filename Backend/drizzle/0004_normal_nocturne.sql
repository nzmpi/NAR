CREATE TABLE "pool_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"total_assets_usd" numeric(78, 0) NOT NULL,
	"total_shares" numeric(78, 0) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"value_usd" numeric(78, 0) NOT NULL,
	"principal_usd" numeric(78, 0) NOT NULL,
	"liquid_value_usd" numeric(78, 0) NOT NULL,
	"locked_value_usd" numeric(78, 0) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_usd" numeric(78, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pool_snapshots" ADD CONSTRAINT "pool_snapshots_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_snapshots" ADD CONSTRAINT "pool_snapshots_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_balance_snapshots" ADD CONSTRAINT "user_balance_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_balance_snapshots" ADD CONSTRAINT "user_balance_snapshots_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_flows" ADD CONSTRAINT "user_flows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_flows" ADD CONSTRAINT "user_flows_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pool_snapshots_unique" ON "pool_snapshots" USING btree ("settlement_id","pool_id");--> statement-breakpoint
CREATE INDEX "pool_snapshots_time_idx" ON "pool_snapshots" USING btree ("pool_id","taken_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ubs_user_settlement_unique" ON "user_balance_snapshots" USING btree ("user_id","settlement_id");--> statement-breakpoint
CREATE INDEX "ubs_user_time_idx" ON "user_balance_snapshots" USING btree ("user_id","taken_at");--> statement-breakpoint
CREATE INDEX "user_flows_user_idx" ON "user_flows" USING btree ("user_id","settlement_id");