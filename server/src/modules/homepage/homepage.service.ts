import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { DB, type Database, type DbTransaction } from "../../db/db.module";
import { files, homepageConfig, homepageWorks, type HomeMedia } from "../../db/schema";
import { badRequest, conflict, notFound } from "../../common/errors";
import { StorageService } from "../storage/storage.service";
import type { HomeConfigDto, HomeWorkDto } from "./dto/homepage.dto";
import { brandKeys, configMedia, initialHomeConfig, initialWorks, publicMedia, visibleConfigMedia } from "./homepage-content";

type Work = typeof homepageWorks.$inferSelect;
const workMedia = (work: Pick<Work, "media" | "poster"> | null) => work ? [work.media, work.poster].filter((m): m is HomeMedia => !!m) : [];
const publicWork = (work: Work) => ({ id: work.id, title: work.title, category: work.category, kind: work.kind, prompt: work.prompt, media: publicMedia(work.media)!, poster: publicMedia(work.poster), sortOrder: work.sortOrder });

@Injectable()
export class HomepageService {
    constructor(@Inject(DB) private readonly db: Database, private readonly storage: StorageService) {}

    async admin() {
        const [config] = await this.db.select().from(homepageConfig).where(eq(homepageConfig.id, 1));
        const works = await this.db.select().from(homepageWorks).orderBy(asc(homepageWorks.sortOrder), asc(homepageWorks.id));
        return { initialized: config?.initialized ?? false, config: config?.content ?? null, works };
    }
    async publicHome() {
        const [config, works] = await Promise.all([this.publicConfig(), this.publicWorks()]);
        return { ...config, ...works };
    }
    async publicConfig() {
        const [row] = await this.db.select().from(homepageConfig).where(eq(homepageConfig.id, 1));
        const config = row?.content;
        return {
            config: config ? {
                hero: config.hero.visible ? { title: config.hero.title, subtitle: config.hero.subtitle, media: publicMedia(config.hero.media) } : null,
                entries: config.entries.filter((e) => e.visible).map((e) => ({ kind: e.kind, title: e.title, description: e.description, media: publicMedia(e.media) })),
            } : null,
        };
    }
    async publicWorks() {
        const works = await this.db.select().from(homepageWorks).where(eq(homepageWorks.published, true)).orderBy(asc(homepageWorks.sortOrder), asc(homepageWorks.id));
        return { works: works.map(publicWork) };
    }
    async work(id: string) {
        const [work] = await this.db.select().from(homepageWorks).where(and(eq(homepageWorks.id, id), eq(homepageWorks.published, true)));
        if (!work) throw notFound("作品不存在或已下架");
        return publicWork(work);
    }
    async media(key: string) {
        const [config] = await this.db.select().from(homepageConfig).where(eq(homepageConfig.id, 1));
        const works = await this.db.select({ media: homepageWorks.media, poster: homepageWorks.poster }).from(homepageWorks).where(eq(homepageWorks.published, true));
        const referenced = [...visibleConfigMedia(config?.content ?? null), ...works.flatMap(workMedia)].some((m) => m.source === "upload" && m.key === key);
        if (!referenced) throw notFound("媒体不存在或已下架");
        const file = await this.storage.findByStorageKeyPublic(key);
        if (!file) throw notFound("媒体不存在");
        return file;
    }
    async adminMedia(key: string, ownerId: string) {
        const owned = await this.storage.findByStorageKey(ownerId, key);
        if (owned) return owned;
        const data = await this.admin();
        if (![...configMedia(data.config), ...data.works.flatMap(workMedia)].some((m) => m.source === "upload" && m.key === key)) throw notFound("文件不存在");
        const file = await this.storage.findByStorageKeyPublic(key);
        if (!file) throw notFound("文件不存在");
        return file;
    }
    private async lock(tx: DbTransaction) {
        await tx.insert(homepageConfig).values({ id: 1 }).onConflictDoNothing();
        const [row] = await tx.select().from(homepageConfig).where(eq(homepageConfig.id, 1)).for("update");
        return row;
    }
    /** Membership changes and owner-checked file retention commit together. */
    private async references(tx: DbTransaction, before: HomeMedia[], after: HomeMedia[], ownerId: string) {
        const oldKeys = new Set(before.filter((m) => m.source === "upload").map((m) => m.key));
        const newKeys = new Set(after.filter((m) => m.source === "upload").map((m) => m.key));
        for (const key of [...new Set([...oldKeys, ...newKeys])].sort()) {
            const [file] = await tx.select().from(files).where(and(eq(files.storageKey, key), isNull(files.deletedAt))).for("update");
            if (newKeys.has(key) && (!file || file.ownerId !== ownerId)) throw badRequest("INVALID_MEDIA", "只能引用本人上传的文件");
            if (!file) continue;
            if (newKeys.has(key) && !oldKeys.has(key)) await tx.update(files).set({ refCount: sql`${files.refCount} + 1` }).where(eq(files.id, file.id));
            if (!newKeys.has(key) && oldKeys.has(key)) await tx.update(files).set({ refCount: sql`greatest(${files.refCount} - 1, 0)` }).where(eq(files.id, file.id));
        }
    }
    private async validateMedia(tx: DbTransaction, media: HomeMedia | null, kind: "image" | "video") {
        if (!media) return;
        if (media.source === "brand") {
            if (kind !== "image" || !brandKeys.includes(media.key as typeof brandKeys[number])) throw badRequest("INVALID_MEDIA", "品牌素材无效");
            return;
        }
        const [file] = await tx.select().from(files).where(and(eq(files.storageKey, media.key), isNull(files.deletedAt)));
        const valid = kind === "image" ? /^image\/(png|jpeg|webp|gif|avif)$/ : /^video\/(mp4|webm|quicktime)$/;
        if (!file || !valid.test(file.mimeType)) throw badRequest("INVALID_MEDIA", "媒体格式与作品类型不匹配");
    }
    async saveConfig(body: HomeConfigDto, userId: string) {
        if (!body.hero || body.entries.length !== 3 || new Set(body.entries.map((e) => e.kind)).size !== 3) throw badRequest("INVALID_CONFIG", "请配置图片、视频和画布三个入口");
        return this.db.transaction(async (tx) => {
            const before = await this.lock(tx);
            for (const m of configMedia(body)) await this.validateMedia(tx, m, "image");
            await this.references(tx, configMedia(before.content), configMedia(body), userId);
            await tx.update(homepageConfig).set({ content: body, initialized: true, updatedAt: new Date() }).where(eq(homepageConfig.id, 1));
            return { config: body, audit: { targetId: "homepage", before: { config: before.content }, after: { config: body } } };
        });
    }
    async saveWork(id: string | null, body: HomeWorkDto, userId: string) {
        if (!body.media || (body.kind === "video" && !body.poster)) throw badRequest("MEDIA_REQUIRED", "请选择作品媒体，视频还需封面");
        return this.db.transaction(async (tx) => {
            await this.lock(tx);
            const [before] = id ? await tx.select().from(homepageWorks).where(eq(homepageWorks.id, id)) : [];
            if (id && !before) throw notFound("作品不存在");
            await this.validateMedia(tx, body.media, body.kind);
            await this.validateMedia(tx, body.poster, "image");
            await this.references(tx, workMedia(before ?? null), workMedia(body), userId);
            const value = { ...body, poster: body.poster ?? null, published: id ? body.published : false, updatedAt: new Date() };
            const [after] = id ? await tx.update(homepageWorks).set(value).where(eq(homepageWorks.id, id)).returning() : await tx.insert(homepageWorks).values(value).returning();
            await tx.update(homepageConfig).set({ initialized: true }).where(eq(homepageConfig.id, 1));
            return { work: after, audit: { targetId: after.id, before: before ?? {}, after } };
        });
    }
    async remove(id: string, userId: string) {
        return this.db.transaction(async (tx) => {
            await this.lock(tx);
            const [before] = await tx.select().from(homepageWorks).where(eq(homepageWorks.id, id));
            if (!before) throw notFound("作品不存在");
            await this.references(tx, workMedia(before), [], userId);
            await tx.delete(homepageWorks).where(eq(homepageWorks.id, id));
            return { id, audit: { targetId: id, before } };
        });
    }
    async initialize() {
        return this.db.transaction(async (tx) => {
            const row = await this.lock(tx);
            const [existing] = await tx.select({ id: homepageWorks.id }).from(homepageWorks).limit(1);
            if (row.initialized || row.content || existing) throw conflict("HOME_INITIALIZED", "已有首页配置，不覆盖管理员内容");
            await tx.update(homepageConfig).set({ initialized: true, content: initialHomeConfig, updatedAt: new Date() }).where(eq(homepageConfig.id, 1));
            await tx.insert(homepageWorks).values(initialWorks);
            return { initialized: true, audit: { targetId: "homepage", before: {}, after: { config: initialHomeConfig, works: initialWorks } } };
        });
    }
}
