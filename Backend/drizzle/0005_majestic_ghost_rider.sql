CREATE TABLE "chain_scan_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" uuid NOT NULL,
	"last_scanned_block" numeric(78, 0) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_scan_state_chain_id_unique" UNIQUE("chain_id")
);
--> statement-breakpoint
ALTER TABLE "deposit_transfers" ADD COLUMN "block_hash" text;--> statement-breakpoint
ALTER TABLE "deposit_transfers" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chain_scan_state" ADD CONSTRAINT "chain_scan_state_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;