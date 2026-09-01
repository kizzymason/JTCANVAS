import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, moneyColumn, updatedAt } from "./_shared";

/**
 * Third-party payment gateways (Z-Pay / 易支付彩虹协议, and later others).
 * Merchant secrets are AES-256-GCM at rest; admin APIs never return plaintext.
 */
export const paymentChannels = pgTable(
    "payment_channels",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        name: text("name").notNull(),
        /** Adapter key, e.g. "epay". Resolved through PaymentGatewayRegistry — never branch on this in wallet credit. */
        driver: text("driver").default("epay").notNull(),
        gatewayUrl: text("gateway_url").notNull(),
        /** Merchant PID for 易支付. */
        merchantId: text("merchant_id").default("").notNull(),
        secretCipher: text("secret_cipher").default("").notNull(),
        secretKeyId: text("secret_key_id").default("").notNull(),
        /** Enabled checkout methods: "alipay" | "wxpay". */
        methods: jsonb("methods").$type<string[]>().default(["alipay"]).notNull(),
        /** Driver extras such as { cid: "123,456" }. */
        extra: jsonb("extra").$type<Record<string, unknown>>().default({}).notNull(),
        enabled: boolean("enabled").default(true).notNull(),
        sortOrder: integer("sort_order").default(100).notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [index("payment_channels_enabled_idx").on(table.enabled)],
);

/**
 * Wallet top-up SKUs. `faceValue` is credited; `salePrice` is what the gateway charges.
 * A discount package has salePrice < faceValue.
 */
export const rechargePackages = pgTable(
    "recharge_packages",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        name: text("name").notNull(),
        faceValue: moneyColumn("face_value").notNull(),
        salePrice: moneyColumn("sale_price").notNull(),
        enabled: boolean("enabled").default(true).notNull(),
        sortOrder: integer("sort_order").default(100).notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        check("recharge_packages_face_positive", sql`${table.faceValue} > 0`),
        check("recharge_packages_sale_positive", sql`${table.salePrice} > 0`),
        index("recharge_packages_enabled_idx").on(table.enabled),
    ],
);
