ALTER TABLE "position_lots" ADD COLUMN "cap_year_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "position_lots" ADD COLUMN "cap_base_usd" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "position_lots" ADD COLUMN "cap_used_usd" numeric(78, 0) DEFAULT '0' NOT NULL;