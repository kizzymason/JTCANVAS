import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { DB, type Database } from "../../db/db.module";
import { projects } from "../../db/schema";
import { notFound, versionConflict } from "../../common/errors";
import type { Paginated } from "../../common/types";
import { StorageService } from "../storage/storage.service";

export type Project = typeof projects.$inferSelect;

/** Matches the storage key prefixes the canvas embeds in node metadata. */
const STORAGE_KEY_PATTERN = /^(image|video|audio|file|video-reference|audio-reference):/;

@Injectable()
export class ProjectsService {
    constructor(
        @Inject(DB) private readonly db: Database,
        private readonly storage: StorageService,
    ) {}

    /** List view: deliberately omits `data`, which can be megabytes per project. */
    async list(ownerId: string, query: { page: number; pageSize: number }): Promise<Paginated<Omit<Project, "data">>> {
        const where = and(eq(projects.ownerId, ownerId), isNull(projects.deletedAt));
        const [items, [counted]] = await Promise.all([
            this.db
                .select({
                    id: projects.id,
                    ownerId: projects.ownerId,
                    title: projects.title,
                    version: projects.version,
                    nodeCount: projects.nodeCount,
                    coverFileId: projects.coverFileId,
                    createdAt: projects.createdAt,
                    updatedAt: projects.updatedAt,
                    deletedAt: projects.deletedAt,
                })
                .from(projects)
                .where(where)
                .orderBy(desc(projects.updatedAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(projects).where(where),
        ]);
        return { items, total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    async get(ownerId: string, id: string) {
        const [project] = await this.db
            .select()
            .from(projects)
            .where(and(eq(projects.id, id), eq(projects.ownerId, ownerId), isNull(projects.deletedAt)))
            .limit(1);
        if (!project) throw notFound("画布不存在");
        return project;
    }

    async create(ownerId: string, input: { title: string; data?: Record<string, unknown> }) {
        const data = input.data ?? {};
        const [created] = await this.db
            .insert(projects)
            .values({ ownerId, title: input.title, data, nodeCount: countNodes(data) })
            .returning();
        await this.storage.retain(collectStorageKeys(data), ownerId);
        return created;
    }

    /**
     * Optimistic lock. The client sends the version it loaded; a mismatch means another tab or device
     * saved in between, so we reject instead of silently discarding their work.
     */
    async update(ownerId: string, id: string, input: { title?: string; data?: Record<string, unknown>; version: number }) {
        const current = await this.get(ownerId, id);
        if (current.version !== input.version) throw versionConflict(current.version);

        const data = input.data ?? (current.data as Record<string, unknown>);
        const [updated] = await this.db
            .update(projects)
            .set({
                ...(input.title === undefined ? {} : { title: input.title }),
                ...(input.data === undefined ? {} : { data, nodeCount: countNodes(data) }),
                version: sql`${projects.version} + 1`,
                updatedAt: new Date(),
            })
            // Version is re-checked in the WHERE clause so two concurrent saves cannot both win.
            .where(and(eq(projects.id, id), eq(projects.ownerId, ownerId), eq(projects.version, input.version)))
            .returning();
        if (!updated) throw versionConflict(current.version);

        if (input.data !== undefined) await this.syncReferences(ownerId, current.data as Record<string, unknown>, data);
        return updated;
    }

    /** Soft delete so a sync from another device cannot resurrect it. */
    async remove(ownerId: string, ids: string[]) {
        if (!ids.length) return 0;
        const removed = await this.db
            .update(projects)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(projects.ownerId, ownerId), inIds(ids), isNull(projects.deletedAt)))
            .returning({ id: projects.id, data: projects.data });
        for (const project of removed) await this.storage.releaseKeys(collectStorageKeys(project.data as Record<string, unknown>), ownerId);
        return removed.length;
    }

    /** Reference counting so a file stays alive while any project still points at it. */
    private async syncReferences(ownerId: string, before: Record<string, unknown>, after: Record<string, unknown>) {
        const previous = new Set(collectStorageKeys(before));
        const next = new Set(collectStorageKeys(after));
        const added = [...next].filter((key) => !previous.has(key));
        const removed = [...previous].filter((key) => !next.has(key));
        await this.storage.retain(added, ownerId);
        await this.storage.releaseKeys(removed, ownerId);
    }
}

/** Walks the whole payload; node metadata is an open, plugin-extensible shape. */
export function collectStorageKeys(value: unknown, keys = new Set<string>()): string[] {
    if (typeof value === "string") {
        if (STORAGE_KEY_PATTERN.test(value)) keys.add(value);
        return [...keys];
    }
    if (Array.isArray(value)) {
        for (const item of value) collectStorageKeys(item, keys);
        return [...keys];
    }
    if (value && typeof value === "object") {
        for (const item of Object.values(value)) collectStorageKeys(item, keys);
    }
    return [...keys];
}

function countNodes(data: Record<string, unknown>) {
    const nodes = data.nodes;
    return Array.isArray(nodes) ? nodes.length : 0;
}

function inIds(ids: string[]) {
    return sql`${projects.id} = any(${sql.param(ids)}::uuid[])`;
}
