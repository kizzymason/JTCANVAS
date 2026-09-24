import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { HomepageService } from "./homepage.service";
import { initialHomeConfig, initialWorks } from "./homepage-content";
import { HomeConfigDto, HomeWorkDto } from "./dto/homepage.dto";

/** Script only returned rows; retain actual Drizzle predicates for access-boundary assertions. */
function database(rows: unknown[][]) {
    const predicates: SQL[] = [];
    const writes: unknown[] = [];
    const take = () => rows.shift() ?? [];
    const db = {
        select: vi.fn(() => {
            const query = {
                from: () => query,
                where: (predicate: SQL) => { predicates.push(predicate); return query; },
                orderBy: () => query,
                limit: () => query,
                for: () => query,
                then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(take()).then(resolve),
            };
            return query;
        }),
        insert: vi.fn(() => ({ values: (value: unknown) => {
            writes.push(value);
            return { onConflictDoNothing: async () => undefined, returning: async () => [{ id: "work-id", ...(value as object) }] };
        } })),
        update: vi.fn(() => ({ set: (value: unknown) => {
            writes.push(value);
            return { where: () => ({ returning: async () => [{ id: "work-id", ...(value as object) }] }) };
        } })),
        delete: vi.fn(() => ({ where: async () => undefined })),
        transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
    };
    return { db, predicates, writes };
}
const upload = { source: "upload" as const, key: "image:private" };
const file = { id: "file-1", ownerId: "owner-a", storageKey: upload.key, mimeType: "image/webp", refCount: 1 };
const empty = { id: 1, content: null, initialized: false };
const work = { ...initialWorks[0], id: "work-id", media: upload };
const predicate = (value: SQL) => new PgDialect().sqlToQuery(value);
function setup(rows: unknown[][]) {
    const mock = database(rows);
    const storage = { findByStorageKeyPublic: vi.fn(async () => file), findByStorageKey: vi.fn(async () => null) };
    return { ...mock, storage, service: new HomepageService(mock.db as never, storage as never) };
}

describe("homepage publication and file access", () => {
    it("returns empty content without implicitly initializing examples", async () => {
        const { service, db } = setup([[], []]);
        expect(await service.publicHome()).toEqual({ config: null, works: [] });
        expect(db.insert).not.toHaveBeenCalled();
    });
    it("public reads restrict works to published rows and return only display fields", async () => {
        const { service, predicates } = setup([[{ content: initialHomeConfig }], [work]]);
        const result = await service.publicHome();
        expect(predicate(predicates[1])).toMatchObject({ params: [true] });
        expect(predicate(predicates[1]).sql).toContain('"published"');
        expect(result.works[0]).not.toHaveProperty("published");
        expect(result.works[0].media).not.toHaveProperty("key");
        expect(result.works[0].media.url).toContain("/api/homepage/media/");
    });
    it("loads public brand config independently of published works", async () => {
        const { service, predicates } = setup([[{ content: initialHomeConfig }]]);
        const result = await service.publicConfig();
        expect(result.config?.entries).toHaveLength(3);
        expect(predicates).toHaveLength(1);
    });
    it("loads only public display fields in the independent works response", async () => {
        const { service, predicates } = setup([[work]]);
        const result = await service.publicWorks();
        expect(result.works).toHaveLength(1);
        expect(result.works[0]).not.toHaveProperty("published");
        expect(result.works[0].media).not.toHaveProperty("key");
        expect(predicate(predicates[0]).params).toEqual([true]);
    });
    it("requires both id and publication status for same-style creation", async () => {
        const { service, predicates } = setup([[]]);
        await expect(service.work("requested-id")).rejects.toThrow("作品不存在或已下架");
        expect(predicate(predicates[0]).params).toEqual(["requested-id", true]);
    });
    it("does not read storage for arbitrary or draft-only keys", async () => {
        const { service, storage, predicates } = setup([[empty], []]);
        await expect(service.media(upload.key)).rejects.toThrow("媒体不存在或已下架");
        expect(storage.findByStorageKeyPublic).not.toHaveBeenCalled();
        expect(predicate(predicates[1]).params).toEqual([true]);
    });
    it("allows a published reference and revokes access after unpublishing", async () => {
        const { service, storage } = setup([[empty], [work], [empty], []]);
        expect(await service.media(upload.key)).toEqual(file);
        await expect(service.media(upload.key)).rejects.toThrow("媒体不存在或已下架");
        expect(storage.findByStorageKeyPublic).toHaveBeenCalledTimes(1);
    });
    it("does not expose hidden brand-section uploads", async () => {
        const content = structuredClone(initialHomeConfig);
        content.hero.media = upload;
        content.hero.visible = false;
        const { service, storage } = setup([[{ content }], []]);
        await expect(service.media(upload.key)).rejects.toThrow();
        expect(storage.findByStorageKeyPublic).not.toHaveBeenCalled();
    });
    it("does expose an enabled banner upload", async () => {
        const content = structuredClone(initialHomeConfig);
        content.hero.media = upload;
        const { service } = setup([[{ content }], []]);
        expect(await service.media(upload.key)).toEqual(file);
    });
    it("never lets an admin preview an unrelated private file", async () => {
        const { service, storage } = setup([[empty], []]);
        await expect(service.adminMedia(upload.key, "owner-b")).rejects.toThrow("文件不存在");
        expect(storage.findByStorageKeyPublic).not.toHaveBeenCalled();
    });
    it.each([false, true])("rejects another owner's upload, existing reference: %s", async (existing) => {
        const { service, db } = setup([[empty], ...(existing ? [[work]] : []), [file], [file]]);
        await expect(service.saveWork(existing ? work.id : null, work, "owner-b")).rejects.toThrow("只能引用本人上传的文件");
        expect(db.update).not.toHaveBeenCalled();
    });
    it("creates drafts even if the client attempts to publish during creation", async () => {
        const { service } = setup([[empty]]);
        const result = await service.saveWork(null, initialWorks[0], "owner-a");
        expect(result.work.published).toBe(false);
        expect(result.audit).toMatchObject({ targetId: "work-id", before: {}, after: { published: false } });
    });
    it("rejects brand path traversal and image-only assets used as video", async () => {
        const { service } = setup([[empty], [empty]]);
        await expect(service.saveWork(null, { ...initialWorks[0], media: { source: "brand", key: "../../private" } }, "owner-a")).rejects.toThrow("品牌素材无效");
        await expect(service.saveWork(null, { ...initialWorks[0], kind: "video", poster: initialWorks[0].media }, "owner-a")).rejects.toThrow("品牌素材无效");
    });
    it.each([
        { ...empty, initialized: true },
        { ...empty, content: initialHomeConfig },
    ])("initialization never restores deleted or saved content", async (row) => {
        const { service, db } = setup([[row], []]);
        await expect(service.initialize()).rejects.toThrow("已有首页配置，不覆盖管理员内容");
        expect(db.update).not.toHaveBeenCalled();
    });
    it("initialization refuses existing works, even without brand config", async () => {
        const { service, db } = setup([[empty], [{ id: "draft" }]]);
        await expect(service.initialize()).rejects.toThrow();
        expect(db.update).not.toHaveBeenCalled();
    });
    it("explicit initialization saves examples and an audit snapshot", async () => {
        const { service, writes } = setup([[empty], []]);
        expect(await service.initialize()).toMatchObject({ initialized: true, audit: { targetId: "homepage", after: { config: initialHomeConfig } } });
        expect(writes).toContainEqual(initialWorks);
    });
    it("validation rejects missing nested config and non-whitelisted media fields", async () => {
        expect(await validate(plainToInstance(HomeConfigDto, { entries: [] }))).not.toHaveLength(0);
        expect(await validate(plainToInstance(HomeWorkDto, { ...initialWorks[0], media: { ...upload, ownerId: "forged" } }), { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(0);
    });
});
