import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { StorageDriver, type DownloadTarget, type StoredObject } from "./storage.driver";

/**
 * Local-disk driver. Authorisation happens in Node, but the bytes are served by nginx through
 * X-Accel-Redirect so a large image never occupies an event-loop tick.
 */
export class LocalStorageDriver extends StorageDriver {
    readonly name = "local" as const;

    constructor(
        private readonly root: string,
        private readonly internalPrefix: string,
        /** Production nginx can send the bytes; without it, Node must stream them itself. */
        private readonly xAccelRedirect = false,
    ) {
        super();
    }

    async put(objectPath: string, body: Buffer, mimeType: string): Promise<StoredObject> {
        const absolute = this.absolute(objectPath);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, body);
        return { objectPath, bytes: body.byteLength, mimeType };
    }

    get(objectPath: string) {
        return readFile(this.absolute(objectPath));
    }

    async delete(objectPath: string) {
        await rm(this.absolute(objectPath), { force: true });
    }

    async download(objectPath: string, mimeType: string): Promise<DownloadTarget> {
        if (this.xAccelRedirect) {
            // nginx maps `internalPrefix` to `root` with `internal;` so the path cannot be requested directly.
            return { kind: "internal", path: `${this.internalPrefix}/${objectPath}` };
        }
        return { kind: "stream", body: await this.get(objectPath), mimeType: mimeType || "application/octet-stream" };
    }

    /** Blocks path traversal: a crafted storage key must not escape the storage root. */
    private absolute(objectPath: string) {
        const absolute = resolve(join(this.root, objectPath));
        const rootWithSep = resolve(this.root) + sep;
        if (!absolute.startsWith(rootWithSep)) throw new Error(`Refusing to access path outside storage root: ${objectPath}`);
        return absolute;
    }
}

/** Deterministic, collision-resistant object layout: <owner>/<yyyymm>/<hash>.<ext> */
export function buildObjectPath(ownerId: string, storageKey: string, extension: string) {
    const month = new Date().toISOString().slice(0, 7).replace("-", "");
    const digest = createHash("sha256").update(storageKey).digest("hex").slice(0, 32);
    return `${ownerId}/${month}/${digest}${extension ? `.${extension}` : ""}`;
}
