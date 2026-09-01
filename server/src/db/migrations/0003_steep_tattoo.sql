CREATE TABLE "payment_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"driver" text DEFAULT 'epay' NOT NULL,
	"gateway_url" text NOT NULL,
	"merchant_id" text DEFAULT '' NOT NULL,
	"secret_cipher" text DEFAULT '' NOT NULL,
	"secret_key_id" text DEFAULT '' NOT NULL,
	"methods" jsonb DEFAULT '["alipay"]'::jsonb NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recharge_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"face_value" numeric(18, 6) NOT NULL,
	"sale_price" numeric(18, 6) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recharge_packages_face_positive" CHECK ("recharge_packages"."face_value" > 0),
	CONSTRAINT "recharge_packages_sale_positive" CHECK ("recharge_packages"."sale_price" > 0)
);
--> statement-breakpoint
CREATE INDEX "payment_channels_enabled_idx" ON "payment_channels" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "recharge_packages_enabled_idx" ON "recharge_packages" USING btree ("enabled");