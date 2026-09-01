export type StoredObject = {
    objectPath: string;
    bytes: number;
    mimeType: string;
};

export type DownloadTarget =
    /** S3: hand the browser a time-limited URL and stay out of the data path. */
    | { kind: "redirect"; url: string }
    /** Local disk: let nginx serve the bytes via X-Accel-Redirect after we authorise the request. */
    | { kind: "internal"; path: string }
    /** Fallback for environments without nginx (dev, tests). */
    | { kind: "stream"; body: Buffer; mimeType: string };

/**
 * One interface, two implementations, selected by the admin at runtime. Business code never branches
 * on the driver; it asks the StorageService, which resolves the active driver per call.
 */
export abstract class StorageDriver {
    abstract readonly name: "local" | "s3";
    abstract put(objectPath: string, body: Buffer, mimeType: string): Promise<StoredObject>;
    abstract get(objectPath: string): Promise<Buffer>;
    abstract delete(objectPath: string): Promise<void>;
    abstract download(objectPath: string, mimeType: string, fileName?: string): Promise<DownloadTarget>;
}
