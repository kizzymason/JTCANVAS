CREATE TABLE "model_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_groups_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "model_presentations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_value" text NOT NULL,
	"group_id" uuid,
	"summary" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"badges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_presentations_model_value_unique" UNIQUE("model_value")
);
--> statement-breakpoint
ALTER TABLE "model_presentations" ADD CONSTRAINT "model_presentations_group_id_model_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."model_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_presentations_group_idx" ON "model_presentations" USING btree ("group_id","sort_order");