CREATE TYPE "public"."api_key_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."api_log_status" AS ENUM('success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reseller_status" AS ENUM('pending', 'approved', 'rejected', 'suspended');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'reseller';--> statement-breakpoint
ALTER TYPE "public"."billing_mode" ADD VALUE 'per_token';--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"key_prefix" text DEFAULT '' NOT NULL,
	"key_hash" text NOT NULL,
	"key_tail" text DEFAULT '' NOT NULL,
	"status" "api_key_status" DEFAULT 'active' NOT NULL,
	"quota_limit" numeric(18, 6),
	"quota_used" numeric(18, 6) DEFAULT '0' NOT NULL,
	"rpm_limit" integer DEFAULT 0 NOT NULL,
	"concurrency_limit" integer DEFAULT 0 NOT NULL,
	"model_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_ips" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "api_request_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"api_key_id" uuid,
	"task_id" uuid,
	"channel_id" uuid,
	"endpoint" text NOT NULL,
	"capability" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"status" "api_log_status" NOT NULL,
	"http_status" integer DEFAULT 200 NOT NULL,
	"error_code" text DEFAULT '' NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"billed_amount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"multiplier" numeric(18, 6) DEFAULT '1' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"client_ip" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_usage_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stat_date" date NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"failed_requests" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"billed_amount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_usage_daily_user_date_unique" UNIQUE("user_id","stat_date")
);
--> statement-breakpoint
CREATE TABLE "reseller_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tier_id" uuid,
	"status" "reseller_status" DEFAULT 'pending' NOT NULL,
	"multiplier_override" numeric(18, 6),
	"company_name" text DEFAULT '' NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"contact_phone" text DEFAULT '' NOT NULL,
	"contact_email" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"use_case" text DEFAULT '' NOT NULL,
	"expected_volume" text DEFAULT '' NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reject_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reseller_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"multiplier" numeric(18, 6) DEFAULT '0' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reseller_tiers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_task_id_generation_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."generation_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage_daily" ADD CONSTRAINT "api_usage_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reseller_accounts" ADD CONSTRAINT "reseller_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reseller_accounts" ADD CONSTRAINT "reseller_accounts_tier_id_reseller_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."reseller_tiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reseller_accounts" ADD CONSTRAINT "reseller_accounts_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_status_idx" ON "api_keys" USING btree ("status");--> statement-breakpoint
CREATE INDEX "api_request_logs_user_created_idx" ON "api_request_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "api_request_logs_key_created_idx" ON "api_request_logs" USING btree ("api_key_id","created_at");--> statement-breakpoint
CREATE INDEX "api_request_logs_model_idx" ON "api_request_logs" USING btree ("model");--> statement-breakpoint
CREATE INDEX "api_usage_daily_date_idx" ON "api_usage_daily" USING btree ("stat_date");--> statement-breakpoint
CREATE INDEX "reseller_accounts_status_idx" ON "reseller_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reseller_accounts_tier_idx" ON "reseller_accounts" USING btree ("tier_id");--> statement-breakpoint
CREATE INDEX "reseller_tiers_sort_idx" ON "reseller_tiers" USING btree ("sort_order");