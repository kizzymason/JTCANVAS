import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { DB, type Database } from "../../db/db.module";
import { assets } from "../../db/schema";
import { badRequest, notFound } from "../../common/errors";
import type { Paginated } from "../../common/types";
import { StorageService, type StoredFile } from "../storage/storage.service";
import type { CreateAssetDto, UpdateAssetDto } from "./dto/assets.dto";

export type Asset = typeof assets.$inferSelect;
export type AssetKind = Asset["kind"];

@Injectable()
export class AssetsService {
    constructor(
        @Inject(DB) private readonly db: Database,
        private readonly storage: StorageService,
    ) {}

    async list(ownerId: string, query: { page: number; pageSize: number; kind?: AssetKind; keyword?: string }): Promise<Paginated<Asset>> {
        const filters = [
            eq(assets.ownerId, ownerId),
            isNull(assets.deletedAt),
            query.kind ? eq(assets.kind, query.kind) : undefined,
            // Search title, body and note together; tags are JSONB so they are matched as text.
            query.keyword ? or(ilike(assets.title, `%${query.keyword}%`), ilike(assets.content, `%${query.keyword}%`), sql`${assets.tags}::text ilike ${`%${query.keyword}%`}`) : undefined,
        ].filter(Boolean);
        const where = and(...filters);

        const [items, [counted]] = await Promise.all([
            this.db
                .select()
                .from(assets)
                .where(where)
                .orderBy(desc(assets.updatedAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(assets).where(where),
        ]);
        return { items, total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    async create(ownerId: string, input: CreateAssetDto) {
        const file = await this.resolveFile(ownerId, input);
        if (needsFile(input.kind) && !file) throw badRequest("ASSET_FILE_MISSING", "素材文件不存在");
        const [created] = await this.db
            .insert(assets)
            .values({
                ownerId,
                kind: input.kind,
                title: input.title,
                content: input.content ?? "",
                fileId: input.fileId ?? file?.id ?? null,
                coverFileId: input.coverFileId ?? null,
                tags: input.tags ?? [],
                source: input.source ?? "",
                note: input.note ?? "",
                metadata: mergeFileMetadata(input.metadata, file),
            })
            .returning();
        await this.retainFiles(ownerId, created);
        return created;
    }

    async update(ownerId: string, id: string, input: UpdateAssetDto) {
        const current = await this.get(ownerId, id);
        const bindingFile = input.fileId !== undefined || input.storageKey !== undefined;
        const file = bindingFile ? await this.resolveFile(ownerId, input) : null;
        if (bindingFile && needsFile(input.kind ?? current.kind) && !file && !input.fileId) throw badRequest("ASSET_FILE_MISSING", "素材文件不存在");
        const nextFileId = input.fileId !== undefined ? input.fileId : file ? file.id : undefined;
        const [updated] = await this.db
            .update(assets)
            .set({
                ...(input.title === undefined ? {} : { title: input.title }),
                ...(input.content === undefined ? {} : { content: input.content }),
                ...(nextFileId === undefined ? {} : { fileId: nextFileId }),
                ...(input.coverFileId === undefined ? {} : { coverFileId: input.coverFileId }),
                ...(input.tags === undefined ? {} : { tags: input.tags }),
                ...(input.source === undefined ? {} : { source: input.source }),
                ...(input.note === undefined ? {} : { note: input.note }),
                ...(input.metadata === undefined && !file ? {} : { metadata: mergeFileMetadata(input.metadata ?? current.metadata, file) }),
                updatedAt: new Date(),
            })
            .where(and(eq(assets.id, id), eq(assets.ownerId, ownerId)))
            .returning();

        // Swap file references when the attachment changed.
        if (nextFileId !== undefined && nextFileId !== current.fileId) {
            await this.releaseFiles(ownerId, current);
            await this.retainFiles(ownerId, updated);
        }
        return updated;
    }

    async get(ownerId: string, id: string) {
        const [asset] = await this.db
            .select()
            .from(assets)
            .where(and(eq(assets.id, id), eq(assets.ownerId, ownerId), isNull(assets.deletedAt)))
            .limit(1);
        if (!asset) throw notFound("素材不存在");
        return asset;
    }

    async remove(ownerId: string, ids: string[]) {
        if (!ids.length) return 0;
        const removed = await this.db
            .update(assets)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(assets.ownerId, ownerId), inIds(ids), isNull(assets.deletedAt)))
            .returning();
        for (const asset of removed) await this.releaseFiles(ownerId, asset);
        return removed.length;
    }

    private async resolveFile(ownerId: string, input: { fileId?: string; storageKey?: string; metadata?: Record<string, unknown> }) {
        if (input.fileId) return this.storage.findById(ownerId, input.fileId);
        const storageKey = input.storageKey || (typeof input.metadata?.storageKey === "string" ? input.metadata.storageKey : undefined);
        if (!storageKey) return null;
        return this.storage.findByStorageKey(ownerId, storageKey);
    }

    private async retainFiles(ownerId: string, asset: Asset) {
        const ids = [asset.fileId, asset.coverFileId].filter((value): value is string => Boolean(value));
        for (const id of ids) {
            const file = await this.storage.findById(ownerId, id);
            if (file) await this.storage.retain([file.storageKey], ownerId);
        }
    }

    private async releaseFiles(ownerId: string, asset: Asset) {
        const ids = [asset.fileId, asset.coverFileId].filter((value): value is string => Boolean(value));
        for (const id of ids) {
            const file = await this.storage.findById(ownerId, id);
            if (file) await this.storage.releaseKeys([file.storageKey], ownerId);
        }
    }
}

function needsFile(kind: AssetKind) {
    return kind === "image" || kind === "video" || kind === "audio";
}

function mergeFileMetadata(metadata: Record<string, unknown> | undefined, file: StoredFile | null) {
    if (!file) return metadata ?? {};
    return {
        ...(metadata ?? {}),
        storageKey: file.storageKey,
        width: file.width ?? metadata?.width ?? 0,
        height: file.height ?? metadata?.height ?? 0,
        bytes: file.bytes,
        mimeType: file.mimeType,
    };
}

function inIds(ids: string[]) {
    return sql`${assets.id} = any(${sql.param(ids)}::uuid[])`;
}
