ALTER TABLE "pool_states" DROP CONSTRAINT "pool_states_asset_id_unique";--> statement-breakpoint
ALTER TABLE "pool_states" DROP CONSTRAINT "pool_states_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "user_positions" DROP CONSTRAINT "user_positions_asset_id_assets_id_fk";
--> statement-breakpoint
DROP INDEX "user_positions_user_asset_unique";--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "amount_usd" numeric(78, 0) NOT NULL;--> statement-breakpoint
ALTER TABLE "pool_states" ADD COLUMN "total_assets_usd" numeric(78, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_positions" ADD COLUMN "assets_usd" numeric(78, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_positions" ADD COLUMN "reserved_assets_usd" numeric(78, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "amount_usd" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "pool_states" DROP COLUMN "asset_id";--> statement-breakpoint
ALTER TABLE "pool_states" DROP COLUMN "total_assets";--> statement-breakpoint
ALTER TABLE "user_positions" DROP COLUMN "asset_id";--> statement-breakpoint
ALTER TABLE "user_positions" DROP COLUMN "assets";--> statement-breakpoint
ALTER TABLE "user_positions" DROP COLUMN "reserved_assets";--> statement-breakpoint
ALTER TABLE "user_positions" ADD CONSTRAINT "user_positions_user_id_unique" UNIQUE("user_id");