-- Replaces the wholesale draw model with hosted-checkout channel sales.
--
-- Under the old model a downstream held prepaid credit, drew codes and collected the buyer's money
-- itself. Under the new one the downstream is a cashier: we price the sale, our payment channel
-- collects it, we deliver the codes, and the channel earns a commission we pay out by hand. That
-- makes us the seller and merchant of record on every order, which is why every sale now lives in
-- `card_orders` and the separate draw tables are gone.
--
-- Destructive by design. It drops the draw tables and the prepaid-credit columns, whose semantics
-- have no counterpart in the new model — a credit balance is money owed *to* us, a commission
-- balance is money owed *by* us, and silently reinterpreting one as the other would be a real
-- accounting error. The guard below refuses to run if any of that data actually exists.
DO $$
DECLARE
    draw_count integer;
    credit_total numeric;
BEGIN
    SELECT count(*) INTO draw_count FROM card_merchant_draws;
    SELECT coalesce(sum(credit_balance), 0) INTO credit_total FROM card_merchants;
    IF draw_count > 0 OR credit_total > 0 THEN
        RAISE EXCEPTION
            'Refusing to migrate: % wholesale draw(s) and % CNY of prepaid credit exist. Settle or refund them first, then re-run.',
            draw_count, credit_total;
    END IF;
END $$;--> statement-breakpoint

DROP TABLE "card_merchant_draw_items" CASCADE;--> statement-breakpoint
DROP TABLE "card_merchant_draws" CASCADE;--> statement-breakpoint

-- Commission history replaces credit history; the vocabulary changed, so the old rows cannot be
-- reinterpreted. Empty by the guard above.
DELETE FROM "card_merchant_ledger";--> statement-breakpoint
ALTER TABLE "card_merchant_ledger" DROP COLUMN "draw_id";--> statement-breakpoint
ALTER TABLE "card_merchant_ledger" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "card_merchant_ledger" ADD COLUMN "payout_id" uuid;--> statement-breakpoint
ALTER TABLE "card_merchant_ledger" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "card_merchant_ledger" ADD CONSTRAINT "card_merchant_ledger_type_valid" CHECK ("card_merchant_ledger"."type" in ('commission', 'payout', 'reversal', 'adjust'));--> statement-breakpoint
CREATE UNIQUE INDEX "card_merchant_ledger_commission_unique" ON "card_merchant_ledger" USING btree ("order_id","type") WHERE "card_merchant_ledger"."order_id" is not null;--> statement-breakpoint

-- Channel terms: commission instead of a discount, a payable balance instead of a credit line, plus
-- the guards that keep one channel from reshaping our payment account's daily profile.
ALTER TABLE "card_merchants" DROP CONSTRAINT "card_merchants_credit_non_negative";--> statement-breakpoint
ALTER TABLE "card_merchants" DROP CONSTRAINT "card_merchants_discount_positive";--> statement-breakpoint
ALTER TABLE "card_merchants" DROP COLUMN "credit_balance";--> statement-breakpoint
ALTER TABLE "card_merchants" DROP COLUMN "price_mode";--> statement-breakpoint
ALTER TABLE "card_merchants" DROP COLUMN "discount_rate";--> statement-breakpoint
ALTER TABLE "card_merchants" DROP COLUMN "low_balance_threshold";--> statement-breakpoint
ALTER TABLE "card_merchants" DROP COLUMN "daily_draw_limit";--> statement-breakpoint
ALTER TABLE "card_merchants" DROP COLUMN "low_balance_notified_at";--> statement-breakpoint
ALTER TABLE "card_merchants" ADD COLUMN "commission_mode" text DEFAULT 'rate' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_merchants" ADD COLUMN "commission_rate" numeric(18, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_merchants" ADD COLUMN "commission_balance" numeric(18, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_merchants" ADD COLUMN "hold_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "card_merchants" ADD COLUMN "daily_sales_limit" numeric(18, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_merchants" ADD COLUMN "return_urls" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "card_merchants" ADD COLUMN "checkout_label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_merchants" ADD COLUMN "preferred_channel_id" uuid;--> statement-breakpoint
ALTER TABLE "card_merchants" ADD COLUMN "payout_account" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_merchants" ADD COLUMN "suspended_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_merchants" ADD CONSTRAINT "card_merchants_commission_non_negative" CHECK ("card_merchants"."commission_balance" >= 0);--> statement-breakpoint
ALTER TABLE "card_merchants" ADD CONSTRAINT "card_merchants_rate_non_negative" CHECK ("card_merchants"."commission_rate" >= 0);--> statement-breakpoint
ALTER TABLE "card_merchants" ADD CONSTRAINT "card_merchants_hold_days_non_negative" CHECK ("card_merchants"."hold_days" >= 0);--> statement-breakpoint
ALTER TABLE "card_merchants" ADD CONSTRAINT "card_merchants_commission_mode_valid" CHECK ("card_merchants"."commission_mode" in ('rate', 'fixed'));--> statement-breakpoint

-- Channel sales now live alongside retail sales in one table, so there is one funds pool and one
-- uniqueness guarantee on the stock.
ALTER TABLE "card_orders" ADD COLUMN "merchant_id" uuid;--> statement-breakpoint
ALTER TABLE "card_orders" ADD COLUMN "merchant_reference" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_orders" ADD COLUMN "commission_rate" numeric(18, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_orders" ADD COLUMN "commission_amount" numeric(18, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_orders" ADD COLUMN "commission_state" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_orders" ADD COLUMN "commission_payable_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "card_orders" ADD CONSTRAINT "card_orders_merchant_id_card_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."card_merchants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_orders" ADD CONSTRAINT "card_orders_commission_non_negative" CHECK ("card_orders"."commission_amount" >= 0);--> statement-breakpoint
ALTER TABLE "card_orders" ADD CONSTRAINT "card_orders_commission_state_valid" CHECK ("card_orders"."commission_state" in ('none', 'pending', 'accrued', 'reversed'));--> statement-breakpoint
CREATE INDEX "card_orders_merchant_created_idx" ON "card_orders" USING btree ("merchant_id","created_at");--> statement-breakpoint
-- A channel's own order id is the idempotency key for its checkouts: a retried request finds the
-- original order instead of charging the buyer a second time.
CREATE UNIQUE INDEX "card_orders_merchant_reference_unique" ON "card_orders" USING btree ("merchant_id","merchant_reference") WHERE "card_orders"."merchant_id" is not null and "card_orders"."merchant_reference" <> '';--> statement-breakpoint

CREATE TABLE "card_merchant_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"method" text DEFAULT '' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"operator_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_merchant_payouts_positive" CHECK ("card_merchant_payouts"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "card_merchant_payouts" ADD CONSTRAINT "card_merchant_payouts_merchant_id_card_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."card_merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_merchant_payouts" ADD CONSTRAINT "card_merchant_payouts_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_merchant_payouts_merchant_created_idx" ON "card_merchant_payouts" USING btree ("merchant_id","created_at");--> statement-breakpoint

DROP TYPE "public"."card_merchant_price_mode";--> statement-breakpoint
DROP TYPE "public"."card_merchant_ledger_type";
