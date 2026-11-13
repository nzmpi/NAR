ALTER TABLE "deposit_intents" ADD COLUMN "sweep_tx_hash" text;--> statement-breakpoint
ALTER TABLE "deposit_intents" ADD COLUMN "swept_by_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "deposit_intents" ADD COLUMN "swept_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deposit_intents" ADD CONSTRAINT "deposit_intents_swept_by_admin_id_admins_id_fk" FOREIGN KEY ("swept_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;