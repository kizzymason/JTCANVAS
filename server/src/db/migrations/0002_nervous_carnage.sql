CREATE TYPE "public"."visitor_kind" AS ENUM('human', 'bot', 'suspected');--> statement-breakpoint
CREATE TABLE "registration_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint_hash" text NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"user_id" uuid,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_locks_fingerprint_hash_unique" UNIQUE("fingerprint_hash")
);
--> statement-breakpoint
CREATE TABLE "visitor_daily_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stat_date" date NOT NULL,
	"path" text NOT NULL,
	"kind" "visitor_kind" NOT NULL,
	"pv" integer DEFAULT 0 NOT NULL,
	"uv" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "visitor_daily_stats_date_path_kind_unique" UNIQUE("stat_date","path","kind")
);
--> statement-breakpoint
CREATE TABLE "visitor_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" text NOT NULL,
	"user_id" uuid,
	"ip" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"path" text NOT NULL,
	"kind" "visitor_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registration_locks" ADD CONSTRAINT "registration_locks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_events" ADD CONSTRAINT "visitor_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registration_locks_ip_registered_idx" ON "registration_locks" USING btree ("ip","registered_at");--> statement-breakpoint
CREATE INDEX "visitor_daily_stats_date_idx" ON "visitor_daily_stats" USING btree ("stat_date");--> statement-breakpoint
CREATE INDEX "visitor_events_created_idx" ON "visitor_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "visitor_events_kind_idx" ON "visitor_events" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "visitor_events_path_idx" ON "visitor_events" USING btree ("path");--> statement-breakpoint
CREATE INDEX "visitor_events_visitor_idx" ON "visitor_events" USING btree ("visitor_id");