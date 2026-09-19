import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, moneyColumn, updatedAt } from "./_shared";
import { users } from "./users";
import { orderStatus, redeemCards } from "./wallet";

/**
 * A sellable card category. Stock lives in `redeem_card_batches.product_id`, so a product can be
 * restocked repeatedly and every code it hands out is an ordinary redeem card: the buyer redeems it
 * on their own account exactly like a card received any other way.
 */
export const cardProducts = pgTable(
    "card_products",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        name: text("name").notNull(),
        description: text("description").default("").notNull(),
        /** Balance the card credits when redeemed. Display only; the card row carries the real value. */
        faceValue: moneyColumn("face_value").notNull(),
        /** What the buyer pays per card. */
        salePrice: moneyColumn("sale_price").notNull(),
        /** Guardrail for a public, unauthenticated page. */
        perOrderLimit: integer("per_order_limit").default(10).notNull(),
        enabled: boolean("enabled").default(true).notNull(),
        sortOrder: integer("sort_order").default(100).notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        check("card_products_face_positive", sql`${table.faceValue} > 0`),
        check("card_products_sale_positive", sql`${table.salePrice} > 0`),
        check("card_products_limit_positive", sql`${table.perOrderLimit} > 0`),
        index("card_products_enabled_idx").on(table.enabled, table.sortOrder),
    ],
);

/**
 * Commission owed for one sale: `pending` while inside the hold window, `accrued` once it counts
 * towards a payout, `reversed` if the payment came back. Retail sales sit at `none`.
 *
 * Modelled as checked text rather than a Postgres enum, like the other channel vocabularies below:
 * these are commercial terms that get renamed as the business changes, and a CHECK gives the same
 * integrity as an enum without turning every rename into a type swap.
 */
export const CARD_COMMISSION_STATES = ["none", "pending", "accrued", "reversed"] as const;
export type CardCommissionState = (typeof CARD_COMMISSION_STATES)[number];

/**
 * One card sale, whether it came from our own `/cards` page or from a sales channel.
 *
 * Deliberately separate from `orders`: those always belong to a user and move a wallet balance,
 * whereas a card sale never touches a wallet and has no account behind it.
 *
 * Channel sales live in this same table on purpose. We are the seller and the merchant of record on
 * every one of them — we price it, we collect it through our own payment channel, we deliver the
 * codes and we carry the support obligation. The channel is a sales agent earning commission, which
 * is why `merchantId` is just a tag here rather than a separate economy.
 */
export const cardOrders = pgTable(
    "card_orders",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        orderNo: text("order_no").notNull().unique(),
        /** Stored lower-cased; the lookup page matches on it. */
        email: text("email").notNull(),
        productId: uuid("product_id").references(() => cardProducts.id, { onDelete: "set null" }),
        /** Snapshots so a later product rename or deletion cannot rewrite history. */
        productName: text("product_name").default("").notNull(),
        faceValue: moneyColumn("face_value").default("0").notNull(),
        unitPrice: moneyColumn("unit_price").notNull(),
        quantity: integer("quantity").notNull(),
        amount: moneyColumn("amount").notNull(),
        status: orderStatus("status").default("pending").notNull(),
        paymentProvider: text("payment_provider").default("").notNull(),
        providerTxnId: text("provider_txn_id").default("").notNull(),
        paidAt: timestamp("paid_at", { withTimezone: true }),
        /** How many codes were actually handed over; below `quantity` means stock ran out after payment. */
        deliveredCount: integer("delivered_count").default(0).notNull(),
        clientIp: text("client_ip").default("").notNull(),
        /**
         * SHA-256 of a 32-byte token handed to the buyer at checkout. Required to read the codes: the
         * order number alone is a timestamp plus four random bytes, which is too little entropy to be
         * the only thing between a stranger and someone else's cards.
         */
        accessTokenHash: text("access_token_hash").default("").notNull(),
        /** Null for a sale on our own storefront. */
        merchantId: uuid("merchant_id").references(() => cardMerchants.id, { onDelete: "set null" }),
        /** The channel's own order id, echoed back so it can reconcile against its books. */
        merchantReference: text("merchant_reference").default("").notNull(),
        /** Snapshots, so re-negotiating a rate never rewrites what was already earned. */
        commissionRate: moneyColumn("commission_rate").default("0").notNull(),
        commissionAmount: moneyColumn("commission_amount").default("0").notNull(),
        commissionState: text("commission_state").$type<CardCommissionState>().default("none").notNull(),
        /** When the commission leaves the hold window and becomes payable. */
        commissionPayableAt: timestamp("commission_payable_at", { withTimezone: true }),
        metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        check("card_orders_quantity_positive", sql`${table.quantity} > 0`),
        check("card_orders_commission_non_negative", sql`${table.commissionAmount} >= 0`),
        check("card_orders_commission_state_valid", sql`${table.commissionState} in ('none', 'pending', 'accrued', 'reversed')`),
        index("card_orders_email_created_idx").on(table.email, table.createdAt),
        index("card_orders_status_idx").on(table.status),
        index("card_orders_merchant_created_idx").on(table.merchantId, table.createdAt),
        /**
         * Makes a channel's own order id the idempotency key for checkout: a retried request finds
         * the original order instead of opening a second one against the same downstream sale.
         */
        uniqueIndex("card_orders_merchant_reference_unique")
            .on(table.merchantId, table.merchantReference)
            .where(sql`${table.merchantId} is not null and ${table.merchantReference} <> ''`),
    ],
);

/**
 * Codes handed to a buyer. The unique constraint on `card_id` is the real guarantee that a card can
 * never be sold twice, no matter how the delivery path is entered; `code` is snapshotted so a
 * purchase stays readable even if an admin later deletes the card row.
 */
export const cardOrderItems = pgTable(
    "card_order_items",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        orderId: uuid("order_id")
            .notNull()
            .references(() => cardOrders.id, { onDelete: "cascade" }),
        cardId: uuid("card_id").references(() => redeemCards.id, { onDelete: "set null" }),
        code: text("code").notNull(),
        createdAt: createdAt(),
    },
    (table) => [unique("card_order_items_card_unique").on(table.cardId), index("card_order_items_order_idx").on(table.orderId)],
);

/** `rate` takes a share of what the buyer paid; `fixed` pays a flat amount per card sold. */
export const CARD_MERCHANT_COMMISSION_MODES = ["rate", "fixed"] as const;
export type CardMerchantCommissionMode = (typeof CARD_MERCHANT_COMMISSION_MODES)[number];

export const CARD_MERCHANT_LEDGER_TYPES = ["commission", "payout", "reversal", "adjust"] as const;
export type CardMerchantLedgerType = (typeof CARD_MERCHANT_LEDGER_TYPES)[number];

/**
 * A sales channel: a downstream site that shows our cards in its own UI and sends buyers to our
 * hosted checkout. It is a cashier and a referrer, nothing more — it never holds stock, never takes
 * the buyer's money, and never sets a price. Every payment lands in our own payment channel, and the
 * channel is paid a commission out of what actually settled.
 *
 * That split is what keeps the arrangement clean with the payment provider: we are the seller and
 * the merchant of record, so the funds are ours by right and the payout is a service fee, not a
 * settlement of somebody else's money.
 *
 * The secret is the only credential and lives server-side at the channel: only its SHA-256 is stored
 * here, and the plaintext is returned exactly once at issue time.
 */
export const cardMerchants = pgTable(
    "card_merchants",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        name: text("name").notNull(),
        /** Shown in the console, e.g. `sk_cd_a1b2c3`. Never enough to authenticate. */
        secretPrefix: text("secret_prefix").default("").notNull(),
        secretTail: text("secret_tail").default("").notNull(),
        secretHash: text("secret_hash").notNull().unique(),
        commissionMode: text("commission_mode").$type<CardMerchantCommissionMode>().default("rate").notNull(),
        /** Share of the settled amount under `rate`, or CNY per card under `fixed`. */
        commissionRate: moneyColumn("commission_rate").default("0").notNull(),
        /**
         * Commission earned but not yet paid out, in CNY. A liability rather than a credit line, so
         * it may never go negative: paying out more than is owed would be an accounting error.
         */
        commissionBalance: moneyColumn("commission_balance").default("0").notNull(),
        /**
         * Days a commission waits before it counts as payable. A refund or chargeback lands well
         * after the sale, and netting it off is far easier than clawing a paid dividend back.
         */
        holdDays: integer("hold_days").default(7).notNull(),
        /**
         * Ceiling on how much this channel may push through our payment channel in a day, in CNY.
         * A sudden volume spike on one merchant account is exactly what triggers a gateway review,
         * so every channel gets a cap. 0 means unlimited.
         */
        dailySalesLimit: moneyColumn("daily_sales_limit").default("0").notNull(),
        /** Allowed product ids; empty array means every enabled product. */
        productScope: jsonb("product_scope").$type<string[]>().default([]).notNull(),
        /** Allowed source IPs for the API; empty array means no restriction. */
        allowedIps: jsonb("allowed_ips").$type<string[]>().default([]).notNull(),
        /**
         * Where the cashier sends the buyer back to. Admin-approved rather than caller-supplied:
         * echoing an arbitrary URL from a request would turn our callback into an open redirect.
         */
        returnUrls: jsonb("return_urls").$type<string[]>().default([]).notNull(),
        /**
         * Description shown on the payment page. Configurable so it can stay neutral and consistent
         * instead of advertising a card-code category to the gateway's review team.
         */
        checkoutLabel: text("checkout_label").default("").notNull(),
        /** Pins this channel to one payment channel, so volume can be spread across several. */
        preferredChannelId: uuid("preferred_channel_id"),
        /** How the dividend is paid. Reference only; we never move money automatically. */
        payoutAccount: text("payout_account").default("").notNull(),
        webhookUrl: text("webhook_url").default("").notNull(),
        webhookSecretCipher: text("webhook_secret_cipher").default("").notNull(),
        webhookSecretKeyId: text("webhook_secret_key_id").default("").notNull(),
        enabled: boolean("enabled").default(true).notNull(),
        /** Set when a guard trips, e.g. the refund rate went past what our account can carry. */
        suspendedReason: text("suspended_reason").default("").notNull(),
        lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        // Last line of defence: a payout may never exceed what was actually earned.
        check("card_merchants_commission_non_negative", sql`${table.commissionBalance} >= 0`),
        check("card_merchants_rate_non_negative", sql`${table.commissionRate} >= 0`),
        check("card_merchants_hold_days_non_negative", sql`${table.holdDays} >= 0`),
        check("card_merchants_commission_mode_valid", sql`${table.commissionMode} in ('rate', 'fixed')`),
        index("card_merchants_enabled_idx").on(table.enabled),
    ],
);

/**
 * Retail price this channel sells a product at, when we have approved a different price point from
 * the storefront's. Still our price: the channel cannot set it, only use it.
 */
export const cardMerchantPrices = pgTable(
    "card_merchant_prices",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        merchantId: uuid("merchant_id")
            .notNull()
            .references(() => cardMerchants.id, { onDelete: "cascade" }),
        productId: uuid("product_id")
            .notNull()
            .references(() => cardProducts.id, { onDelete: "cascade" }),
        unitPrice: moneyColumn("unit_price").notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        unique("card_merchant_prices_unique").on(table.merchantId, table.productId),
        check("card_merchant_prices_positive", sql`${table.unitPrice} > 0`),
    ],
);

/**
 * Append-only commission history. Never UPDATE or DELETE a row here; corrections are new rows.
 * Mirrors `wallet_ledger` so the same reconciliation rule applies: the rows must sum to the balance.
 */
export const cardMerchantLedger = pgTable(
    "card_merchant_ledger",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        merchantId: uuid("merchant_id")
            .notNull()
            .references(() => cardMerchants.id, { onDelete: "cascade" }),
        type: text("type").$type<CardMerchantLedgerType>().notNull(),
        /** Signed: positive is commission earned, negative is a payout or a reversal. */
        amount: moneyColumn("amount").notNull(),
        balanceAfter: moneyColumn("balance_after").notNull(),
        /** The sale that earned it, for `commission` and `reversal` rows. */
        orderId: uuid("order_id"),
        payoutId: uuid("payout_id"),
        operatorId: uuid("operator_id").references(() => users.id, { onDelete: "set null" }),
        note: text("note").default("").notNull(),
        metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
        createdAt: createdAt(),
    },
    (table) => [
        index("card_merchant_ledger_merchant_created_idx").on(table.merchantId, table.createdAt),
        check("card_merchant_ledger_type_valid", sql`${table.type} in ('commission', 'payout', 'reversal', 'adjust')`),
        /**
         * One commission row per sale. The database, not the code, is what guarantees a replayed
         * payment notification cannot pay a channel twice for the same order.
         */
        uniqueIndex("card_merchant_ledger_commission_unique")
            .on(table.orderId, table.type)
            .where(sql`${table.orderId} is not null`),
    ],
);

/**
 * A dividend actually paid to a channel. Recorded by hand after the operator has reconciled the
 * money, which is deliberate: nothing in this system moves funds on its own.
 */
export const cardMerchantPayouts = pgTable(
    "card_merchant_payouts",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        merchantId: uuid("merchant_id")
            .notNull()
            .references(() => cardMerchants.id, { onDelete: "cascade" }),
        amount: moneyColumn("amount").notNull(),
        /** Free text: bank transfer, WeChat, offset against something else. */
        method: text("method").default("").notNull(),
        /** Transfer reference or screenshot id, so a dispute can be traced to a real payment. */
        reference: text("reference").default("").notNull(),
        note: text("note").default("").notNull(),
        operatorId: uuid("operator_id").references(() => users.id, { onDelete: "set null" }),
        createdAt: createdAt(),
    },
    (table) => [
        check("card_merchant_payouts_positive", sql`${table.amount} > 0`),
        index("card_merchant_payouts_merchant_created_idx").on(table.merchantId, table.createdAt),
    ],
);
