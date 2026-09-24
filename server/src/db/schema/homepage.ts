import { boolean, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_shared";

export type HomeMedia = { source: "brand" | "upload"; key: string };
export type HomeConfig = {
    hero: { title: string; subtitle: string; visible: boolean; media: HomeMedia | null };
    entries: Array<{ kind: "image" | "video" | "canvas"; title: string; description: string; visible: boolean; media: HomeMedia | null }>;
};
export const homepageConfig = pgTable("homepage_config", {
    id: integer("id").primaryKey(),
    initialized: boolean("initialized").default(false).notNull(),
    content: jsonb("content").$type<HomeConfig | null>(),
    updatedAt: updatedAt(),
});
export const homepageWorks = pgTable("homepage_works", {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(), category: text("category").notNull(),
    kind: text("kind").$type<"image" | "video">().notNull(),
    prompt: text("prompt").notNull(),
    media: jsonb("media").$type<HomeMedia>().notNull(),
    poster: jsonb("poster").$type<HomeMedia | null>(),
    published: boolean("published").default(false).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: createdAt(), updatedAt: updatedAt(),
});
