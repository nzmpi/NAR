CREATE TABLE "relock_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"source_lot_id" uuid NOT NULL,
	"target_pool_id" uuid NOT NULL,
	"amount_usd" numeric(78, 0),
	"is_max" boolean DEFAULT false NOT NULL,
	"reserved_shares" numeric(78, 0) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"applied_shares" numeric(78, 0),
	"applied_usd" numeric(78, 0),
	"result_lot_id" uuid
);
--> statement-breakpoint
CREATE TABLE "relock_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"settlement_id" uuid,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "relock_items" ADD CONSTRAINT "relock_items_request_id_relock_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."relock_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relock_items" ADD CONSTRAINT "relock_items_source_lot_id_position_lots_id_fk" FOREIGN KEY ("source_lot_id") REFERENCES "public"."position_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relock_items" ADD CONSTRAINT "relock_items_target_pool_id_pools_id_fk" FOREIGN KEY ("target_pool_id") REFERENCES "public"."pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relock_items" ADD CONSTRAINT "relock_items_result_lot_id_position_lots_id_fk" FOREIGN KEY ("result_lot_id") REFERENCES "public"."position_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relock_requests" ADD CONSTRAINT "relock_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relock_requests" ADD CONSTRAINT "relock_requests_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "relock_items_request_idx" ON "relock_items" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "relock_items_status_idx" ON "relock_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "relock_requests_user_idx" ON "relock_requests" USING btree ("user_id","status");