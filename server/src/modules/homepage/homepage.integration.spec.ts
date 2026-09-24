import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgClient } from "../../db/db.module";
import * as schema from "../../db/schema";
import { files, homepageConfig, homepageWorks, users } from "../../db/schema";
import { HomepageService } from "./homepage.service";
import { initialHomeConfig, initialWorks } from "./homepage-content";

// Explicitly opt in to a disposable database; never inherit the application's DATABASE_URL.
const url = process.env.HOMEPAGE_TEST_DATABASE_URL;
describe.skipIf(!url)("homepage PostgreSQL publication transactions", () => {
    if (!url) return;
    if (!new URL(url).pathname.startsWith("/gravity_homepage_test")) throw new Error("Use a disposable gravity_homepage_test database");
    const client = createPgClient(url, 5);
    const db = drizzle(client, { schema });
    const owner = randomUUID();
    const stranger = randomUUID();
    const media = { source: "upload" as const, key: `image:${randomUUID()}` };
    const storage = {
        findByStorageKeyPublic: async (key: string) => (await db.select().from(files).where(and(eq(files.storageKey, key), isNull(files.deletedAt))))[0] ?? null,
        findByStorageKey: async (id: string, key: string) => (await db.select().from(files).where(and(eq(files.ownerId, id), eq(files.storageKey, key), isNull(files.deletedAt))))[0] ?? null,
    };
    const service = new HomepageService(db, storage as never);
    const count = async () => (await storage.findByStorageKeyPublic(media.key))!.refCount;
    let workId: string;
    beforeAll(async () => {
        if ((await db.select().from(homepageConfig)).length || (await db.select().from(homepageWorks)).length) throw new Error("Homepage test database must be empty");
        await db.insert(users).values([{ id: owner, username: `home-${owner}`, passwordHash: "test", role: "admin" }, { id: stranger, username: `home-${stranger}`, passwordHash: "test", role: "admin" }]);
        await db.insert(files).values({ ownerId: owner, storageKey: media.key, driver: "local", objectPath: "test/image.webp", mimeType: "image/webp", bytes: 8 });
    });
    afterAll(async () => { await client.end(); });

    it("serializes example initialization and refuses duplicate initializers", async () => {
        const result = await Promise.allSettled([service.initialize(), service.initialize()]);
        expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(result.filter((r) => r.status === "rejected")).toHaveLength(1);
        expect((await service.publicHome()).works).toHaveLength(4);
    });
    it("rolls back another owner's file reference without inserting a work or retaining files", async () => {
        await expect(service.saveWork(null, { ...initialWorks[0], media, poster: null }, stranger)).rejects.toThrow("只能引用本人上传的文件");
        expect(await count()).toBe(0);
        expect((await service.admin()).works).toHaveLength(4);
    });
    it("creates an uploaded work as draft even when published=true is requested", async () => {
        const result = await service.saveWork(null, { ...initialWorks[0], media, poster: null }, owner);
        workId = result.work.id;
        expect(result.work.published).toBe(false);
        expect(await count()).toBe(1);
        await expect(service.work(workId)).rejects.toThrow();
        await expect(service.media(media.key)).rejects.toThrow();
    });
    it("publishes only the selected work and revokes both detail and media on unpublishing", async () => {
        await service.saveWork(workId, { ...initialWorks[0], media, poster: null, published: true }, owner);
        expect((await service.work(workId)).media.url).toContain(encodeURIComponent(media.key));
        expect((await service.media(media.key)).ownerId).toBe(owner);
        await service.saveWork(workId, { ...initialWorks[0], media, poster: null, published: false }, owner);
        await expect(service.work(workId)).rejects.toThrow();
        await expect(service.media(media.key)).rejects.toThrow();
        expect(await count()).toBe(1);
    });
    it("retains shared banner and work references independently and releases them exactly once", async () => {
        const config = structuredClone(initialHomeConfig);
        config.hero.media = media;
        config.entries[0].media = media;
        await Promise.all([service.saveConfig(config, owner), service.saveConfig(config, owner)]);
        expect(await count()).toBe(2);
        await service.remove(workId, owner);
        expect(await count()).toBe(1);
        expect((await service.media(media.key)).ownerId).toBe(owner);
        config.hero.visible = false;
        config.entries[0].visible = false;
        await service.saveConfig(config, owner);
        await expect(service.media(media.key)).rejects.toThrow();
        await service.saveConfig(initialHomeConfig, owner);
        expect(await count()).toBe(0);
    });
    it("does not restore deleted examples on restart or initialize", async () => {
        for (const work of (await service.admin()).works) await service.remove(work.id, owner);
        const restarted = new HomepageService(db, storage as never);
        await expect(restarted.initialize()).rejects.toThrow("已有首页配置");
        expect((await restarted.publicHome()).works).toEqual([]);
    });
    it("never resolves arbitrary private files through the public media endpoint", async () => {
        await expect(service.media(media.key)).rejects.toThrow();
        await expect(service.adminMedia(media.key, stranger)).rejects.toThrow();
        expect((await service.adminMedia(media.key, owner)).ownerId).toBe(owner);
    });
});
