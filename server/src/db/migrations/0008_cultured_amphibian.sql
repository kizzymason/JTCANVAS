CREATE TYPE "public"."card_merchant_ledger_type" AS ENUM('topup', 'draw', 'refund', 'admin_adjust');--> statement-breakpoint
CREATE TYPE "public"."card_merchant_price_mode" AS ENUM('discount', 'fixed');--> statement-breakpoint
CREATE TABLE "card_merchant_draw_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draw_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"card_id" uuid,
	"code" text NOT NULL,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_merchant_draw_items_card_unique" UNIQUE("card_id")
);
--> statement-breakpoint
CREATE TABLE "card_merchant_draws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"product_id" uuid,
	"product_name" text DEFAULT '' NOT NULL,
	"face_value" numeric(18, 6) DEFAULT '0' NOT NULL,
	"unit_price" numeric(18, 6) NOT NULL,
	"quantity" integer NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"idempotency_key" text NOT NULL,
	"client_ip" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_merchant_draws_idempotency_unique" UNIQUE("merchant_id","idempotency_key"),
	CONSTRAINT "card_merchant_draws_quantity_positive" CHECK ("card_merchant_draws"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "card_merchant_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"type" "card_merchant_ledger_type" NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"balance_after" numeric(18, 6) NOT NULL,
	"draw_id" uuid,
	"operator_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_merchant_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"unit_price" numeric(18, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_merchant_prices_unique" UNIQUE("merchant_id","product_id"),
	CONSTRAINT "card_merchant_prices_positive" CHECK ("card_merchant_prices"."unit_price" > 0)
);
--> statement-breakpoint
CREATE TABLE "card_merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"secret_prefix" text DEFAULT '' NOT NULL,
	"secret_tail" text DEFAULT '' NOT NULL,
	"secret_hash" text NOT NULL,
	"credit_balance" numeric(18, 6) DEFAULT '0' NOT NULL,
	"price_mode" "card_merchant_price_mode" DEFAULT 'discount' NOT NULL,
	"discount_rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"product_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_ips" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"webhook_url" text DEFAULT '' NOT NULL,
	"webhook_secret_cipher" text DEFAULT '' NOT NULL,
	"webhook_secret_key_id" text DEFAULT '' NOT NULL,
	"low_balance_threshold" numeric(18, 6) DEFAULT '0' NOT NULL,
	"daily_draw_limit" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"low_balance_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_merchants_secret_hash_unique" UNIQUE("secret_hash"),
	CONSTRAINT "card_merchants_credit_non_negative" CHECK ("card_merchants"."credit_balance" >= 0),
	CONSTRAINT "card_merchants_discount_positive" CHECK ("card_merchants"."discount_rate" > 0)
);
--> statement-breakpoint
ALTER TABLE "card_orders" ADD COLUMN "access_token_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_merchant_draw_items" ADD CONSTRAINT "card_merchant_draw_items_draw_id_card_merchant_draws_id_fk" FOREIGN KEY ("draw_id") REFERENCES "public"."card_merchant_draws"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_merchant_draw_items" ADD CONSTRAINT "card_merchant_draw_items_merchant_id_card_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."card_merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_merchant_draw_items" ADD CONSTRAINT "card_merchant_draw_items_card_id_redeem_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."redeem_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_merchant_draws" ADD CONSTRAINT "card_merchant_draws_merchant_id_card_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."card_merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_merchant_draws" ADD CONSTRAINT "card_merchant_draws_product_id_card_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."card_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_merchant_ledger" ADD CONSTRAINT "card_merchant_ledger_merchant_id_card_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."card_merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_merchant_ledger" ADD CONSTRAINT "card_merchant_ledger_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_merchant_prices" ADD CONSTRAINT "card_merchant_prices_merchant_id_card_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."card_merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_merchant_prices" ADD CONSTRAINT "card_merchant_prices_product_id_card_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."card_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_merchant_draw_items_draw_idx" ON "card_merchant_draw_items" USING btree ("draw_id");--> statement-breakpoint
CREATE INDEX "card_merchant_draw_items_code_idx" ON "card_merchant_draw_items" USING btree ("code");--> statement-breakpoint
CREATE INDEX "card_merchant_draws_merchant_created_idx" ON "card_merchant_draws" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "card_merchant_ledger_merchant_created_idx" ON "card_merchant_ledger" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "card_merchants_enabled_idx" ON "card_merchants" USING btree ("enabled");