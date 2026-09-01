import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_shared";
import { users } from "./users";

/** Single-row-per-key site configuration: storage driver and credentials, registration switches, gift balance. */
export const settings = pgTable("settings", {
    key: text("key").primaryKey(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
});

/**
 * Every privileged mutation lands here: price changes, balance adjustments, channel edits, card voiding,
 * storage switches. Needed both for compliance and for settling user disputes about balance.
 */
export const auditLogs = pgTable(
    "audit_logs",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
        actorName: text("actor_name").default("").notNull(),
        /** e.g. "channel.update", "wallet.adjust", "settings.storage". */
        action: text("action").notNull(),
        targetType: text("target_type").default("").notNull(),
        targetId: text("target_id").default("").notNull(),
        before: jsonb("before").$type<Record<string, unknown> | null>(),
        after: jsonb("after").$type<Record<string, unknown> | null>(),
        ip: text("ip").default("").notNull(),
        userAgent: text("user_agent").default("").notNull(),
        createdAt: createdAt(),
    },
    (table) => [index("audit_logs_created_idx").on(table.createdAt), index("audit_logs_action_idx").on(table.action), index("audit_logs_actor_idx").on(table.actorId)],
);
