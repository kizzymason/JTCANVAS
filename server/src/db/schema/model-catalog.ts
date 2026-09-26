import { boolean, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_shared";

/** 标识（最新 / 推荐 / 限时…）可以由后台自由维护，因此存对象而不是固定的枚举。 */
export type ModelBadge = { key: string; label: string; tone?: "primary" | "neutral" | "warning" };

/**
 * 模型选择弹窗里的分组，后台可增删改。`key` 供代码引用，`name` 用于展示。
 */
export const modelGroups = pgTable("model_groups", {
    id: uuid("id").defaultRandom().primaryKey(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    sortOrder: integer("sort_order").default(100).notNull(),
    visible: boolean("visible").default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
});

/**
 * 单个模型的展示信息：简介、详细介绍、标识与所属分组。
 * `modelValue` 与渠道里的模型值保持一致（`channelId::modelName`），因此渠道换配置也不需要改这里的记录。
 */
export const modelPresentations = pgTable(
    "model_presentations",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        modelValue: text("model_value").notNull().unique(),
        groupId: uuid("group_id").references(() => modelGroups.id, { onDelete: "set null" }),
        summary: text("summary").default("").notNull(),
        description: text("description").default("").notNull(),
        badges: jsonb("badges").$type<ModelBadge[]>().default([]).notNull(),
        sortOrder: integer("sort_order").default(100).notNull(),
        visible: boolean("visible").default(true).notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [index("model_presentations_group_idx").on(table.groupId, table.sortOrder)],
);
