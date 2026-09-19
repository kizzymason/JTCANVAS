import { boolean, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, moneyColumn, updatedAt } from "./_shared";
import { channels } from "./channels";
import { generationTasks } from "./generation";
import { users } from "./users";

export const resellerStatus = pgEnum("reseller_status", ["pending", "approved", "rejected", "suspended"]);
export const apiKeyStatus = pgEnum("api_key_status", ["active", "disabled"]);
export const apiLogStatus = pgEnum("api_log_status", ["success", "failed"]);

export type ResellerStatus = (typeof resellerStatus.enumValues)[number];
export type ApiKeyStatus = (typeof apiKeyStatus.enumValues)[number];

/**
 * Reseller tiers carry the pricing multiplier. `multiplier` is the signed surcharge, so the billed
 * unit price is `public_price * (1 + multiplier)`: 0.2 marks up 20%, -0.2 discounts 20%.
 */
export const resellerTiers = pgTable(
    "reseller_tiers",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        name: text("name").notNull().unique(),
        /** Signed surcharge, not the final coefficient. Shares the money precision so 0.075 tiers are exact. */
        multiplier: moneyColumn("multiplier").default("0").notNull(),
        description: text("description").default("").notNull(),
        /** New approvals land on the default tier when the admin does not pick one. */
        isDefault: boolean("is_default").default(false).notNull(),
        sortOrder: integer("sort_order").default(100).notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [index("reseller_tiers_sort_idx").on(table.sortOrder)],
);

/**
 * One row per applicant, doubling as the application record and the approved reseller profile.
 * A rejected applicant re-applies by moving the same row back to `pending`, which keeps the review
 * history on a single primary key instead of accumulating duplicate applications.
 */
export const resellerAccounts = pgTable(
    "reseller_accounts",
    {
        userId: uuid("user_id")
            .primaryKey()
            .references(() => users.id, { onDelete: "cascade" }),
        tierId: uuid("tier_id").references(() => resellerTiers.id, { onDelete: "set null" }),
        status: resellerStatus("status").default("pending").notNull(),
        /** Overrides the tier multiplier when set. Null means "inherit the tier". */
        multiplierOverride: moneyColumn("multiplier_override"),
        companyName: text("company_name").default("").notNull(),
        contactName: text("contact_name").default("").notNull(),
        contactPhone: text("contact_phone").default("").notNull(),
        contactEmail: text("contact_email").default("").notNull(),
        website: text("website").default("").notNull(),
        useCase: text("use_case").default("").notNull(),
        expectedVolume: text("expected_volume").default("").notNull(),
        appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
        reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
        reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
        rejectReason: text("reject_reason").default("").notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [index("reseller_accounts_status_idx").on(table.status), index("reseller_accounts_tier_idx").on(table.tierId)],
);

/**
 * Downstream credentials. Only the SHA-256 hash is stored, so a database leak cannot be replayed
 * against the API; `keyPrefix` and `keyTail` exist purely so the console can identify a key.
 */
export const apiKeys = pgTable(
    "api_keys",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        name: text("name").default("").notNull(),
        /** Shown in the console, e.g. `sk-jt-a1b2c3`. Never enough to authenticate. */
        keyPrefix: text("key_prefix").default("").notNull(),
        /** SHA-256 of the plaintext key. The lookup index for every authenticated request. */
        keyHash: text("key_hash").notNull().unique(),
        keyTail: text("key_tail").default("").notNull(),
        status: apiKeyStatus("status").default("active").notNull(),
        /** Lifetime spend ceiling in CNY. Null means unlimited (still bounded by the wallet). */
        quotaLimit: moneyColumn("quota_limit"),
        quotaUsed: moneyColumn("quota_used").default("0").notNull(),
        /** 0 means inherit the platform default. */
        rpmLimit: integer("rpm_limit").default(0).notNull(),
        concurrencyLimit: integer("concurrency_limit").default(0).notNull(),
        /** Allowed public model ids; empty array means every model the platform offers. */
        modelScope: jsonb("model_scope").$type<string[]>().default([]).notNull(),
        /** Allowed client IPs; empty array means no restriction. */
        allowedIps: jsonb("allowed_ips").$type<string[]>().default([]).notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }),
        lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [index("api_keys_user_idx").on(table.userId), index("api_keys_status_idx").on(table.status)],
);

/** Per-request audit trail powering the console log page and the cost breakdown charts. */
export const apiRequestLogs = pgTable(
    "api_request_logs",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
        taskId: uuid("task_id").references(() => generationTasks.id, { onDelete: "set null" }),
        channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),
        endpoint: text("endpoint").notNull(),
        capability: text("capability").default("").notNull(),
        /** Public model id as the caller sent it, kept verbatim for support tickets. */
        model: text("model").default("").notNull(),
        status: apiLogStatus("status").notNull(),
        httpStatus: integer("http_status").default(200).notNull(),
        errorCode: text("error_code").default("").notNull(),
        quantity: integer("quantity").default(0).notNull(),
        inputTokens: integer("input_tokens").default(0).notNull(),
        outputTokens: integer("output_tokens").default(0).notNull(),
        billedAmount: moneyColumn("billed_amount").default("0").notNull(),
        /** Effective coefficient applied to this request, snapshotted for dispute resolution. */
        multiplier: moneyColumn("multiplier").default("1").notNull(),
        latencyMs: integer("latency_ms").default(0).notNull(),
        clientIp: text("client_ip").default("").notNull(),
        /**
         * Null while an asynchronous video task is still running. The worker claims this field when
         * it writes the final amount, which makes quota/log settlement idempotent across polling.
         */
        settledAt: timestamp("settled_at", { withTimezone: true }),
        createdAt: createdAt(),
    },
    (table) => [
        index("api_request_logs_user_created_idx").on(table.userId, table.createdAt),
        index("api_request_logs_key_created_idx").on(table.apiKeyId, table.createdAt),
        index("api_request_logs_model_idx").on(table.model),
        uniqueIndex("api_request_logs_task_unique").on(table.taskId),
    ],
);

/**
 * Daily rollup so the dashboard never scans the raw log table. Mirrors visitor_daily_stats: the
 * recorder upserts increments, and pruning raw logs must not touch these rows.
 */
export const apiUsageDaily = pgTable(
    "api_usage_daily",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        statDate: date("stat_date", { mode: "string" }).notNull(),
        requests: integer("requests").default(0).notNull(),
        failedRequests: integer("failed_requests").default(0).notNull(),
        inputTokens: integer("input_tokens").default(0).notNull(),
        outputTokens: integer("output_tokens").default(0).notNull(),
        billedAmount: moneyColumn("billed_amount").default("0").notNull(),
        updatedAt: updatedAt(),
    },
    (table) => [unique("api_usage_daily_user_date_unique").on(table.userId, table.statDate), index("api_usage_daily_date_idx").on(table.statDate)],
);
