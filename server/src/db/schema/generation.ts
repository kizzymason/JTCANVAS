import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, moneyColumn, updatedAt } from "./_shared";
import { channelModels, channels, modelCapability } from "./channels";
import { users } from "./users";

export const taskStatus = pgEnum("task_status", ["pending", "running", "succeeded", "partial", "failed", "cancelled"]);

/**
 * One row per user-visible generation request, whatever its output count. This is the billing unit:
 * a request for 4 images is one task with quantity 4, not four tasks.
 */
export const generationTasks = pgTable(
    "generation_tasks",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        capability: modelCapability("capability").notNull(),
        channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),
        channelModelId: uuid("channel_model_id").references(() => channelModels.id, { onDelete: "set null" }),
        /** Denormalised so history stays readable after a channel or model is deleted. */
        modelName: text("model_name").notNull(),
        status: taskStatus("status").default("pending").notNull(),
        prompt: text("prompt").default("").notNull(),
        /** Normalised request: size, quality, count, seconds, reference file ids, mask... */
        params: jsonb("params").$type<Record<string, unknown>>().default({}).notNull(),
        /** How many images / seconds / calls were requested. */
        quantity: integer("quantity").default(1).notNull(),
        succeededCount: integer("succeeded_count").default(0).notNull(),
        /** Money frozen at submit time. */
        estimatedCost: moneyColumn("estimated_cost").default("0").notNull(),
        /** Money actually charged after settlement. */
        actualCost: moneyColumn("actual_cost").default("0").notNull(),
        /** Result file ids in output order. */
        outputFileIds: jsonb("output_file_ids").$type<string[]>().default([]).notNull(),
        /** For text generation, the accumulated response. */
        outputText: text("output_text").default("").notNull(),
        providerTaskId: text("provider_task_id").default("").notNull(),
        error: text("error").default("").notNull(),
        /** Where the request came from, for support and analytics. */
        source: text("source").default("").notNull(),
        startedAt: timestamp("started_at", { withTimezone: true }),
        finishedAt: timestamp("finished_at", { withTimezone: true }),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        index("generation_tasks_user_created_idx").on(table.userId, table.createdAt),
        index("generation_tasks_status_idx").on(table.status),
        // Used to enforce the per-user concurrent task cap.
        index("generation_tasks_user_status_idx").on(table.userId, table.status),
    ],
);

/**
 * Guarantees a retried submit reuses the first task instead of freezing money twice.
 * Scoped per user so one user's key cannot collide with another's.
 */
export const idempotencyKeys = pgTable(
    "idempotency_keys",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        scope: text("scope").notNull(),
        key: text("key").notNull(),
        /** Hash of the request body: the same key with a different payload is a client bug, not a retry. */
        requestHash: text("request_hash").notNull(),
        responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
        createdAt: createdAt(),
    },
    // Unique, not just indexed: the constraint is what makes a concurrent double-submit fail instead of double-charge.
    (table) => [unique("idempotency_user_scope_key_unique").on(table.userId, table.scope, table.key)],
);
