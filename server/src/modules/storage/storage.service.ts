import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import sharp from "sharp";
import { DB, type Database } from "../../db/db.module";
import { fileDerivatives, files } from "../../db/schema";
import { badRequest, notFound } from "../../common/errors";
import { CryptoService } from "../crypto/crypto.service";
import { SettingsService, type StorageSettings } from "../settings/settings.service";
import { buildObjectPath, LocalStorageDriver } from "./local.driver";
import { isPublicHttpUrl, publicFileAbsoluteUrl, publicFileToken, assertPublicFileToken } from "./public-file-url";
import { S3StorageDriver } from "./s3.driver";
import type { DownloadTarget, StorageDriver } from "./storage.driver";

export type StoredFile = typeof files.$inferSelect;

/** Derivative sizes: `thumb` for lists and canvas nodes, `medium` for the in-app preview. */
const DERIVATIVES = [
    { variant: "thumb", width: 320 },
    { variant: "medium", width: 1024 },
] as const;

const IMAGE_MIME = /^image\//i;
/** Animated formats are copied as-is; re-encoding them would drop the animation. */
const NON_RESIZABLE = /^image\/(gif|apng|svg\+xml)$/i;

@Injectable()
export class StorageService implements OnApplicationShutdown {
    private readonly logger = new Logger(StorageService.name);
    private cached?: { signature: string; driver: StorageDriver };

    constructor(
        @Inject(DB) private readonly db: Database,
        private readonly settings: SettingsService,
        private readonly crypto: CryptoService,
        private readonly config: ConfigService,
    ) {}

    /**
     * Stores bytes, records the file row, and generates image derivatives.
     * `storageKey` keeps the `<prefix>:<id>` shape the frontend already uses for canvas metadata.
     */
    async save(params: { ownerId: string; body: Buffer; mimeType: string; prefix?: string; width?: number; height?: number; durationMs?: number }) {
        if (!params.body.byteLength) throw badRequest("EMPTY_FILE", "文件内容为空");
        const driver = await this.driver();
        const prefix = params.prefix ?? (IMAGE_MIME.test(params.mimeType) ? "image" : "file");
        const storageKey = `${prefix}:${randomUUID()}`;
        const objectPath = buildObjectPath(params.ownerId, storageKey, extensionFor(params.mimeType));

        const dimensions = IMAGE_MIME.test(params.mimeType) ? await readImageSize(params.body) : undefined;
        const stored = await driver.put(objectPath, params.body, params.mimeType);

        const [row] = await this.db
            .insert(files)
            .values({
                ownerId: params.ownerId,
                storageKey,
                driver: driver.name,
                objectPath: stored.objectPath,
                mimeType: params.mimeType,
                bytes: stored.bytes,
                width: params.width ?? dimensions?.width ?? null,
                height: params.height ?? dimensions?.height ?? null,
                durationMs: params.durationMs ?? null,
            })
            .returning();

        // Derivatives are best-effort: a resize failure must not lose the original upload.
        if (IMAGE_MIME.test(params.mimeType) && !NON_RESIZABLE.test(params.mimeType)) {
            await this.createDerivatives(row, params.body, driver).catch((error) => this.logger.warn(`Derivative generation failed for ${storageKey}: ${String(error)}`));
        }
        return row;
    }

    async findByStorageKey(ownerId: string, storageKey: string) {
        const [row] = await this.db
            .select()
            .from(files)
            .where(and(eq(files.storageKey, storageKey), eq(files.ownerId, ownerId), isNull(files.deletedAt)))
            .limit(1);
        return row ?? null;
    }

    /** Token-gated lookup used when PiAPI fetches a short-lived public file URL. */
    async findByStorageKeyPublic(storageKey: string) {
        const [row] = await this.db.select().from(files).where(and(eq(files.storageKey, storageKey), isNull(files.deletedAt))).limit(1);
        return row ?? null;
    }

    /** Absolute https URL PiAPI can GET, or undefined when APP_PUBLIC_URL is missing/local. */
    signedPublicUrl(storageKey: string) {
        const publicBase = this.config.get<string>("publicUrl") || "";
        if (!isPublicHttpUrl(publicBase)) return undefined;
        const ttl = this.config.get<number>("storage.signedUrlTtlSeconds")!;
        const token = publicFileToken((message) => this.crypto.hmac(message), storageKey, Math.floor(Date.now() / 1000) + ttl);
        return publicFileAbsoluteUrl(publicBase, storageKey, token);
    }

    verifyPublicFileToken(storageKey: string, token: string) {
        assertPublicFileToken((message) => this.crypto.hmac(message), storageKey, token);
    }

    async findById(ownerId: string, id: string) {
        const [row] = await this.db
            .select()
            .from(files)
            .where(and(eq(files.id, id), eq(files.ownerId, ownerId), isNull(files.deletedAt)))
            .limit(1);
        return row ?? null;
    }

    /** Resolves how the client should fetch the bytes. Ownership must already have been verified. */
    async download(file: StoredFile, variant?: string): Promise<DownloadTarget> {
        const driver = await this.driver();
        if (!variant || variant === "original") return driver.download(file.objectPath, file.mimeType);

        const [derivative] = await this.db
            .select()
            .from(fileDerivatives)
            .where(and(eq(fileDerivatives.fileId, file.id), eq(fileDerivatives.variant, variant)))
            .limit(1);
        // Fall back to the original rather than 404-ing when a derivative was never produced.
        if (!derivative) return driver.download(file.objectPath, file.mimeType);
        return driver.download(derivative.objectPath, derivative.mimeType);
    }

    async read(file: StoredFile) {
        const driver = await this.driver();
        return driver.get(file.objectPath);
    }

    /** Reference counting keeps a file alive while any project or asset still points at it. */
    async retain(storageKeys: string[], ownerId: string) {
        if (!storageKeys.length) return;
        await this.db
            .update(files)
            .set({ refCount: sql`${files.refCount} + 1` })
            .where(and(eq(files.ownerId, ownerId), inStorageKeys(storageKeys)));
    }

    async releaseKeys(storageKeys: string[], ownerId: string) {
        if (!storageKeys.length) return;
        await this.db
            .update(files)
            .set({ refCount: sql`greatest(${files.refCount} - 1, 0)` })
            .where(and(eq(files.ownerId, ownerId), inStorageKeys(storageKeys)));
    }

    /**
     * Deletes unreferenced files for one owner. Scoped per owner on purpose: the old browser
     * implementation swept the whole store, which on a server would reach other users' data.
     */
    async collectOrphans(ownerId: string, olderThan = new Date(Date.now() - 24 * 60 * 60 * 1000)) {
        const orphans = await this.db
            .select()
            .from(files)
            .where(and(eq(files.ownerId, ownerId), eq(files.refCount, 0), lt(files.createdAt, olderThan), isNull(files.deletedAt)))
            .limit(500);
        if (!orphans.length) return 0;

        const driver = await this.driver();
        for (const file of orphans) {
            const derivatives = await this.db.select().from(fileDerivatives).where(eq(fileDerivatives.fileId, file.id));
            await Promise.allSettled([driver.delete(file.objectPath), ...derivatives.map((item) => driver.delete(item.objectPath))]);
            // Soft-delete: keeps the storage key resolvable for support even after the bytes are gone.
            await this.db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, file.id));
        }
        this.logger.log(`Collected ${orphans.length} orphan files for owner ${ownerId}`);
        return orphans.length;
    }

    /**
     * Removes object bytes for every file belonging to one owner. The file rows themselves
     * stay until the user row is deleted (cascade). Scoped to a single owner on purpose.
     */
    async purgeAllForOwner(ownerId: string) {
        const rows = await this.db.select().from(files).where(eq(files.ownerId, ownerId));
        if (!rows.length) return 0;

        const driver = await this.driver();
        for (const file of rows) {
            const derivatives = await this.db.select().from(fileDerivatives).where(eq(fileDerivatives.fileId, file.id));
            await Promise.allSettled([driver.delete(file.objectPath), ...derivatives.map((item) => driver.delete(item.objectPath))]);
        }
        this.logger.log(`Purged ${rows.length} stored files for owner ${ownerId}`);
        return rows.length;
    }

    async usageByOwner(ownerId: string) {
        const [row] = await this.db
            .select({ count: sql<number>`count(*)::int`, bytes: sql<string>`coalesce(sum(${files.bytes}), 0)::text` })
            .from(files)
            .where(and(eq(files.ownerId, ownerId), isNull(files.deletedAt)));
        return { count: row?.count ?? 0, bytes: Number(row?.bytes ?? 0) };
    }

    onApplicationShutdown() {
        if (this.cached?.driver instanceof S3StorageDriver) this.cached.driver.destroy();
    }

    private async createDerivatives(file: StoredFile, body: Buffer, driver: StorageDriver) {
        for (const spec of DERIVATIVES) {
            // `withoutEnlargement` avoids upscaling a small original into a bigger "thumbnail".
            const output = await sharp(body).rotate().resize({ width: spec.width, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
            const objectPath = buildObjectPath(file.ownerId, `${file.storageKey}:${spec.variant}`, "webp");
            await driver.put(objectPath, output.data, "image/webp");
            await this.db
                .insert(fileDerivatives)
                .values({ fileId: file.id, variant: spec.variant, objectPath, mimeType: "image/webp", bytes: output.data.byteLength, width: output.info.width, height: output.info.height });
        }
    }

    /** Rebuilt whenever the admin changes storage settings; the signature is the cache key. */
    private async driver(): Promise<StorageDriver> {
        const settings = await this.settings.getStorage();
        const signature = JSON.stringify(settings);
        if (this.cached?.signature === signature) return this.cached.driver;
        if (this.cached?.driver instanceof S3StorageDriver) this.cached.driver.destroy();

        const driver = settings.driver === "s3" ? this.buildS3(settings) : this.buildLocal();
        this.cached = { signature, driver };
        return driver;
    }

    private buildLocal() {
        return new LocalStorageDriver(this.config.get<string>("storage.localRoot")!, this.config.get<string>("storage.internalPrefix")!, this.config.get<boolean>("storage.xAccelRedirect")!);
    }

    private buildS3(settings: StorageSettings) {
        if (!settings.s3.bucket) throw badRequest("STORAGE_NOT_CONFIGURED", "S3 存储尚未配置完整，请在管理后台补全 bucket");
        return new S3StorageDriver({
            endpoint: settings.s3.endpoint,
            region: settings.s3.region,
            bucket: settings.s3.bucket,
            accessKeyId: settings.s3.accessKeyId,
            secretAccessKey: this.crypto.decrypt(settings.s3.secretAccessKeyCipher, settings.s3.secretAccessKeyId),
            forcePathStyle: settings.s3.forcePathStyle,
            publicBaseUrl: settings.s3.publicBaseUrl,
            signedUrlTtlSeconds: this.config.get<number>("storage.signedUrlTtlSeconds")!,
        });
    }
}

function inStorageKeys(keys: string[]) {
    return sql`${files.storageKey} = any(${sql.param(keys)}::text[])`;
}

async function readImageSize(body: Buffer) {
    try {
        const meta = await sharp(body).metadata();
        return { width: meta.width ?? null, height: meta.height ?? null };
    } catch {
        return undefined;
    }
}

const EXTENSIONS: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "application/json": "json",
    "text/plain": "txt",
};

function extensionFor(mimeType: string) {
    return EXTENSIONS[mimeType.toLowerCase()] ?? "bin";
}

/** Thrown when a caller asks for a file that is not theirs. */
export function assertFileOwner(file: StoredFile | null): StoredFile {
    if (!file) throw notFound("文件不存在");
    return file;
}
