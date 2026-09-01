import { bigint, index, integer, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, deletedAt, updatedAt } from "./_shared";
import { users } from "./users";

export const storageDriver = pgEnum("storage_driver", ["local", "s3"]);
export const assetKind = pgEnum("asset_kind", ["text", "image", "video", "audio"]);

/**
 * One row per stored object. `storageKey` keeps the `<prefix>:<id>` shape the frontend already uses,
 * so canvas metadata does not have to be rewritten.
 */
export const files = pgTable(
    "files",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        ownerId: uuid("owner_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        storageKey: text("storage_key").notNull().unique(),
        driver: storageDriver("driver").notNull(),
        /** Path inside the bucket or local root. */
        objectPath: text("object_path").notNull(),
        mimeType: text("mime_type").default("").notNull(),
        bytes: bigint("bytes", { mode: "number" }).default(0).notNull(),
        width: integer("width"),
        height: integer("height"),
        durationMs: integer("duration_ms"),
        /** Incremented when a project/asset references the file, decremented on release. Zero means collectable. */
        refCount: integer("ref_count").default(0).notNull(),
        createdAt: createdAt(),
        deletedAt: deletedAt(),
    },
    (table) => [
        index("files_owner_idx").on(table.ownerId),
        // Drives the orphan sweep, scoped per owner.
        index("files_owner_refcount_idx").on(table.ownerId, table.refCount),
    ],
);

/** Resized variants so galleries and canvas thumbnails never download the original. */
export const fileDerivatives = pgTable(
    "file_derivatives",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        fileId: uuid("file_id")
            .notNull()
            .references(() => files.id, { onDelete: "cascade" }),
        /** "thumb" (320px) or "medium" (1024px). */
        variant: text("variant").notNull(),
        objectPath: text("object_path").notNull(),
        mimeType: text("mime_type").default("image/webp").notNull(),
        bytes: bigint("bytes", { mode: "number" }).default(0).notNull(),
        width: integer("width"),
        height: integer("height"),
        createdAt: createdAt(),
    },
    (table) => [index("file_derivatives_file_variant_idx").on(table.fileId, table.variant)],
);

/**
 * Canvas projects. `data` holds nodes, connections and chat sessions as JSONB because
 * CanvasNodeMetadata is an open, plugin-extensible shape that would ossify if normalised.
 */
export const projects = pgTable(
    "projects",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        ownerId: uuid("owner_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        title: text("title").default("").notNull(),
        data: jsonb("data").$type<Record<string, unknown>>().default({}).notNull(),
        /** Optimistic lock: a save carrying a stale version is rejected instead of silently overwriting. */
        version: integer("version").default(1).notNull(),
        /** Denormalised for the project list so it does not have to parse `data`. */
        nodeCount: integer("node_count").default(0).notNull(),
        coverFileId: uuid("cover_file_id").references(() => files.id, { onDelete: "set null" }),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
        deletedAt: deletedAt(),
    },
    (table) => [index("projects_owner_updated_idx").on(table.ownerId, table.updatedAt), index("projects_owner_deleted_idx").on(table.ownerId, table.deletedAt)],
);

export const assets = pgTable(
    "assets",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        ownerId: uuid("owner_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        kind: assetKind("kind").notNull(),
        title: text("title").default("").notNull(),
        /** Inline body for text assets; empty for binary kinds. */
        content: text("content").default("").notNull(),
        fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
        coverFileId: uuid("cover_file_id").references(() => files.id, { onDelete: "set null" }),
        tags: jsonb("tags").$type<string[]>().default([]).notNull(),
        source: text("source").default("").notNull(),
        note: text("note").default("").notNull(),
        metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
        deletedAt: deletedAt(),
    },
    (table) => [index("assets_owner_updated_idx").on(table.ownerId, table.updatedAt), index("assets_owner_kind_idx").on(table.ownerId, table.kind)],
);
