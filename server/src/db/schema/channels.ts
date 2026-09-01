import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, moneyColumn, updatedAt } from "./_shared";

export const apiFormat = pgEnum("api_format", ["openai", "gemini", "piapi"]);
export const modelCapability = pgEnum("model_capability", ["image", "video", "text", "audio"]);
export const billingMode = pgEnum("billing_mode", ["per_image", "per_second", "per_call"]);
export const piapiAccountStatus = pgEnum("piapi_account_status", ["active", "exhausted", "invalid", "disabled"]);

export const channels = pgTable(
    "channels",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        name: text("name").notNull(),
        baseUrl: text("base_url").notNull(),
        apiFormat: apiFormat("api_format").default("openai").notNull(),
        /** AES-256-GCM ciphertext. Never leaves the server in plaintext. PiAPI channels leave this empty. */
        apiKeyCipher: text("api_key_cipher").default("").notNull(),
        /** Which encryption key produced the ciphertext, so keys can be rotated without downtime. */
        apiKeyId: text("api_key_id").default("").notNull(),
        enabled: boolean("enabled").default(true).notNull(),
        /** Lower runs first when several channels serve the same model. */
        priority: integer("priority").default(100).notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [index("channels_enabled_idx").on(table.enabled)],
);

export const channelModels = pgTable(
    "channel_models",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        channelId: uuid("channel_id")
            .notNull()
            .references(() => channels.id, { onDelete: "cascade" }),
        /** Upstream model identifier, or a PiAPI task_type. */
        name: text("name").notNull(),
        /** What users see; falls back to `name` when empty. */
        displayName: text("display_name").default("").notNull(),
        capability: modelCapability("capability").default("image").notNull(),
        enabled: boolean("enabled").default(true).notNull(),
        /** Optional admin-authored request script, executed in an isolated-vm sandbox inside the worker. */
        script: text("script").default("").notNull(),
        /**
         * Per-model generation UI/limits: image resolutions, max count, transparent background,
         * aspect ratios, video resolutions and max seconds. Parsed with defaults at read time.
         */
        features: jsonb("features").$type<Record<string, unknown>>().default({}).notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        unique("channel_models_channel_name_unique").on(table.channelId, table.name),
        index("channel_models_capability_idx").on(table.capability, table.enabled),
    ],
);

/**
 * Price per (channel, model, spec). `spec` holds the size/quality tier it applies to, or NULL for the
 * model default, which is how PiAPI's 1K vs 2K price difference is expressed.
 */
export const modelPrices = pgTable(
    "model_prices",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        channelModelId: uuid("channel_model_id")
            .notNull()
            .references(() => channelModels.id, { onDelete: "cascade" }),
        billingMode: billingMode("billing_mode").notNull(),
        spec: text("spec"),
        /** CNY per image / per second / per call depending on billingMode. */
        unitPrice: moneyColumn("unit_price").notNull(),
        /** Charged on top of unitPrice for every reference image beyond the first. */
        extraReferencePrice: moneyColumn("extra_reference_price").default("0").notNull(),
        /** Floor applied after quantity math, useful for providers with a minimum charge. */
        minCharge: moneyColumn("min_charge").default("0").notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [index("model_prices_model_idx").on(table.channelModelId)],
);

/** PiAPI key pool, moved server-side from the browser. Rotation state lives here. */
export const piapiAccounts = pgTable(
    "piapi_accounts",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        username: text("username").default("").notNull(),
        apiKeyCipher: text("api_key_cipher").notNull(),
        apiKeyId: text("api_key_id").notNull(),
        /** Last 4 characters, kept in the clear so the admin UI can identify a key without decrypting. */
        apiKeyTail: text("api_key_tail").default("").notNull(),
        status: piapiAccountStatus("status").default("active").notNull(),
        balanceUsd: moneyColumn("balance_usd").default("0").notNull(),
        usedCount: integer("used_count").default(0).notNull(),
        checkedAt: timestamp("checked_at", { withTimezone: true }),
        lastError: text("last_error").default("").notNull(),
        metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [index("piapi_accounts_status_idx").on(table.status)],
);
