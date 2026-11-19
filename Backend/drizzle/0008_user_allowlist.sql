CREATE TABLE "user_allowlist" (
	"telegram_id" text PRIMARY KEY NOT NULL,
	"note" text,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_allowlist" ADD CONSTRAINT "user_allowlist_added_by_admins_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;