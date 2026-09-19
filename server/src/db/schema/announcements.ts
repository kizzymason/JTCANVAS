import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_shared";
import { users } from "./users";

/**
 * Site-wide notices shown in the public app. `content` is sanitized HTML from the admin editor.
 * `slug` is a stable public key so the homepage can open a specific notice (e.g. join-community).
 */
export const announcements = pgTable(
    "announcements",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        slug: text("slug").notNull().unique(),
        title: text("title").notNull(),
        content: text("content").default("").notNull(),
        published: boolean("published").default(false).notNull(),
        pinned: boolean("pinned").default(false).notNull(),
        sortOrder: integer("sort_order").default(100).notNull(),
        createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
        publishedAt: timestamp("published_at", { withTimezone: true }),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [index("announcements_published_idx").on(table.published, table.pinned, table.sortOrder)],
);
