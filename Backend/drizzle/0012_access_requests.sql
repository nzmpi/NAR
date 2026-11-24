CREATE TABLE "access_requests" (
	"telegram_id" text PRIMARY KEY NOT NULL,
	"username" text,
	"first_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	CONSTRAINT "access_requests_status_chk" CHECK ("access_requests"."status" in ('pending','approved','rejected'))
);
--> statement-breakpoint
ALTER TABLE "notification_outbox" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "chat_id" text;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_decided_by_admins_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_requests_status_idx" ON "access_requests" USING btree ("status","requested_at");--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_recipient_chk" CHECK ("notification_outbox"."user_id" IS NOT NULL OR "notification_outbox"."chat_id" IS NOT NULL);