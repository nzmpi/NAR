ALTER TABLE "withdrawals" ADD COLUMN "withdraw_all" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "awaiting_user_at" timestamp with time zone;--> statement-breakpoint
-- Locks made by the old code reserved shares without fixing amounts: unlock
-- them so the admin locks again and the new lock fixes the amounts.
UPDATE "withdrawals" SET "locked_at" = NULL WHERE "status" = 'pending';
