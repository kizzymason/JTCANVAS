CREATE TABLE "homepage_config" (
	"id" integer PRIMARY KEY NOT NULL,
	"initialized" boolean DEFAULT false NOT NULL,
	"content" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homepage_works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"media" jsonb NOT NULL,
	"poster" jsonb,
	"published" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
