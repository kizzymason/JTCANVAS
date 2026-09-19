import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { asc, desc, eq, ilike, sql } from "drizzle-orm";
import { DB, type Database } from "../../db/db.module";
import { announcements } from "../../db/schema";
import { badRequest, conflict, notFound } from "../../common/errors";
import type { Paginated } from "../../common/types";
import { StorageService } from "../storage/storage.service";
import {
    ANNOUNCEMENT_FILE_PREFIX,
    announcementContentIsEmpty,
    announcementMediaUrl,
    isAnnouncementStorageKey,
    isUuid,
    JOIN_COMMUNITY_SLUG,
    sanitizeAnnouncementHtml,
} from "./announcement-html";
import { seedJoinCommunityAnnouncement } from "./announcements.seed";
import type { UpsertAnnouncementDto } from "./dto/announcements.dto";

const IMAGE_MIME = /^(image\/jpeg|image\/png|image\/webp|image\/gif)$/i;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type AnnouncementRow = typeof announcements.$inferSelect;

@Injectable()
export class AnnouncementsService implements OnModuleInit {
    private readonly logger = new Logger(AnnouncementsService.name);

    constructor(
        @Inject(DB) private readonly db: Database,
        private readonly storage: StorageService,
    ) {}

    async onModuleInit() {
        const result = await seedJoinCommunityAnnouncement(this.db);
        this.logger.log(`Join-community announcement ${result.created ? "created" : "ensured"} ${result.id}`);
    }

    async listPublished() {
        const rows = await this.db
            .select()
            .from(announcements)
            .where(eq(announcements.published, true))
            .orderBy(desc(announcements.pinned), asc(announcements.sortOrder), desc(announcements.publishedAt), desc(announcements.createdAt));
        return { items: rows.map(toPublicSummary) };
    }

    async getPublished(idOrSlug: string) {
        const row = await this.findByIdOrSlug(idOrSlug);
        if (!row || !row.published) throw notFound("公告不存在");
        return toPublicDetail(row);
    }

    async listAdmin(query: { page: number; pageSize: number; keyword?: string }): Promise<Paginated<ReturnType<typeof toAdminRow>>> {
        const where = query.keyword?.trim() ? ilike(announcements.title, `%${query.keyword.trim()}%`) : undefined;
        const [countRow] = await this.db.select({ total: sql<number>`count(*)::int` }).from(announcements).where(where);
        const items = await this.db
            .select()
            .from(announcements)
            .where(where)
            .orderBy(desc(announcements.pinned), asc(announcements.sortOrder), desc(announcements.updatedAt))
            .limit(query.pageSize)
            .offset((query.page - 1) * query.pageSize);
        return { items: items.map(toAdminRow), total: countRow?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    async create(body: UpsertAnnouncementDto, userId: string) {
        const content = this.prepareContent(body.content);
        const slug = await this.allocateSlug(body.slug, body.title);
        const published = body.published ?? false;
        const now = new Date();
        const [row] = await this.db
            .insert(announcements)
            .values({
                slug,
                title: body.title.trim(),
                content,
                published,
                pinned: body.pinned ?? false,
                sortOrder: body.sortOrder ?? 100,
                createdBy: userId,
                publishedAt: published ? now : null,
            })
            .returning();
        return { ...toAdminRow(row), audit: { targetId: row.id, after: toAdminRow(row) } };
    }

    async update(id: string, body: UpsertAnnouncementDto) {
        const existing = await this.mustGet(id);
        const content = this.prepareContent(body.content);
        let slug = existing.slug;
        if (body.slug && body.slug !== existing.slug) {
            if (existing.slug === JOIN_COMMUNITY_SLUG) throw badRequest("SLUG_LOCKED", "加入社区公告的标识不能修改");
            slug = await this.allocateSlug(body.slug, body.title);
        }
        const published = body.published ?? existing.published;
        const publishedAt = published ? (existing.publishedAt ?? new Date()) : existing.publishedAt;
        const [row] = await this.db
            .update(announcements)
            .set({
                slug,
                title: body.title.trim(),
                content,
                published,
                pinned: body.pinned ?? existing.pinned,
                sortOrder: body.sortOrder ?? existing.sortOrder,
                publishedAt,
                updatedAt: new Date(),
            })
            .where(eq(announcements.id, id))
            .returning();
        return { ...toAdminRow(row), audit: { targetId: row.id, before: toAdminRow(existing), after: toAdminRow(row) } };
    }

    async remove(id: string) {
        const existing = await this.mustGet(id);
        if (existing.slug === JOIN_COMMUNITY_SLUG) throw badRequest("ANNOUNCEMENT_LOCKED", "加入社区公告不能删除，请改为编辑内容");
        await this.db.delete(announcements).where(eq(announcements.id, id));
        return { id, audit: { targetId: id, before: toAdminRow(existing) } };
    }

    async uploadImage(params: { ownerId: string; body: Buffer; mimeType: string }) {
        if (!IMAGE_MIME.test(params.mimeType)) throw badRequest("INVALID_IMAGE", "仅支持 JPG、PNG、WebP、GIF 图片");
        if (params.body.byteLength > MAX_IMAGE_BYTES) throw badRequest("FILE_TOO_LARGE", "公告图片不能超过 8MB");
        const file = await this.storage.save({
            ownerId: params.ownerId,
            body: params.body,
            mimeType: params.mimeType,
            prefix: "announcement",
        });
        await this.storage.retain([file.storageKey], params.ownerId);
        return {
            storageKey: file.storageKey,
            url: announcementMediaUrl(file.storageKey),
            width: file.width,
            height: file.height,
        };
    }

    async mediaFile(storageKey: string) {
        const key = decodeURIComponent(storageKey);
        if (!isAnnouncementStorageKey(key) || key.includes("/") || key.includes("..")) throw notFound("文件不存在");
        const file = await this.storage.findByStorageKeyPublic(key);
        if (!file || !file.storageKey.startsWith(ANNOUNCEMENT_FILE_PREFIX)) throw notFound("文件不存在");
        return file;
    }

    private prepareContent(html: string) {
        const content = sanitizeAnnouncementHtml(html);
        if (announcementContentIsEmpty(content)) throw badRequest("CONTENT_REQUIRED", "请填写公告内容");
        return content;
    }

    private async allocateSlug(requested: string | undefined, title: string) {
        const candidate = requested?.trim() || slugFromTitle(title);
        const [taken] = await this.db.select({ id: announcements.id }).from(announcements).where(eq(announcements.slug, candidate)).limit(1);
        if (!taken) return candidate;
        if (requested?.trim()) throw conflict("SLUG_TAKEN", "该标识已被其他公告使用");
        return `${candidate}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    }

    private async mustGet(id: string) {
        const [row] = await this.db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
        if (!row) throw notFound("公告不存在");
        return row;
    }

    private async findByIdOrSlug(idOrSlug: string) {
        const value = idOrSlug.trim();
        if (!value) return null;
        const [row] = await this.db
            .select()
            .from(announcements)
            .where(isUuid(value) ? eq(announcements.id, value) : eq(announcements.slug, value))
            .limit(1);
        return row ?? null;
    }
}

function slugFromTitle(title: string) {
    const slug = title
        .trim()
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/[\s_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64);
    if (slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return slug;
    return `a-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function toPublicSummary(row: AnnouncementRow) {
    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        pinned: row.pinned,
        publishedAt: row.publishedAt?.toISOString() ?? row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function toPublicDetail(row: AnnouncementRow) {
    return {
        ...toPublicSummary(row),
        content: sanitizeAnnouncementHtml(row.content),
    };
}

function toAdminRow(row: AnnouncementRow) {
    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        content: row.content,
        published: row.published,
        pinned: row.pinned,
        sortOrder: row.sortOrder,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        locked: row.slug === JOIN_COMMUNITY_SLUG,
    };
}
