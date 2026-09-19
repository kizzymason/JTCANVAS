CREATE TABLE "card_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"card_id" uuid,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_order_items_card_unique" UNIQUE("card_id")
);
--> statement-breakpoint
CREATE TABLE "card_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_no" text NOT NULL,
	"email" text NOT NULL,
	"product_id" uuid,
	"product_name" text DEFAULT '' NOT NULL,
	"face_value" numeric(18, 6) DEFAULT '0' NOT NULL,
	"unit_price" numeric(18, 6) NOT NULL,
	"quantity" integer NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"payment_provider" text DEFAULT '' NOT NULL,
	"provider_txn_id" text DEFAULT '' NOT NULL,
	"paid_at" timestamp with time zone,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"client_ip" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_orders_order_no_unique" UNIQUE("order_no"),
	CONSTRAINT "card_orders_quantity_positive" CHECK ("card_orders"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "card_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"face_value" numeric(18, 6) NOT NULL,
	"sale_price" numeric(18, 6) NOT NULL,
	"per_order_limit" integer DEFAULT 10 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_products_face_positive" CHECK ("card_products"."face_value" > 0),
	CONSTRAINT "card_products_sale_positive" CHECK ("card_products"."sale_price" > 0),
	CONSTRAINT "card_products_limit_positive" CHECK ("card_products"."per_order_limit" > 0)
);
--> statement-breakpoint
ALTER TABLE "redeem_card_batches" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "card_order_items" ADD CONSTRAINT "card_order_items_order_id_card_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."card_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_order_items" ADD CONSTRAINT "card_order_items_card_id_redeem_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."redeem_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_orders" ADD CONSTRAINT "card_orders_product_id_card_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."card_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_order_items_order_idx" ON "card_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "card_orders_email_created_idx" ON "card_orders" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "card_orders_status_idx" ON "card_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "card_products_enabled_idx" ON "card_products" USING btree ("enabled","sort_order");