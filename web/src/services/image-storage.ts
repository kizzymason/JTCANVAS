import i18n from "@/i18n";
import { fileUrl, uploadFile, type FileVariant } from "@/services/api/files";

export type UploadedImage = {
    /** Display URL. Points at the server, so it survives reloads and works across devices. */
    url: string;
    /** Durable server reference. Persist this, never the URL. */
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type ImageReadOptions = { signal?: AbortSignal };

const IMAGE_DECODE_TIMEOUT_MS = 10_000;

/**
 * Images now live on the server. This module keeps the same shape the canvas already relies on
 * (`storageKey` + a display `url`) so node metadata and hydration logic did not have to change,
 * but the bytes go to `/api/files` instead of IndexedDB.
 */
export async function uploadImage(input: string | Blob, options?: ImageReadOptions): Promise<UploadedImage> {
    // Generation results already live on the server; re-uploading them would duplicate the bytes.
    if (typeof input === "string") {
        const existing = storageKeyFromUrl(input);
        if (existing) {
            const meta = await loadImageMeta(input, options);
            return { url: input, storageKey: existing, width: meta?.width ?? 0, height: meta?.height ?? 0, bytes: 0, mimeType: "" };
        }
    }

    const blob = typeof input === "string" ? await fetchAsBlob(input, options) : input;
    const stored = await uploadFile(blob, "image.png");
    return {
        url: fileUrl(stored.storageKey),
        storageKey: stored.storageKey,
        width: stored.width ?? 0,
        height: stored.height ?? 0,
        bytes: stored.bytes,
        mimeType: stored.mimeType,
    };
}

/**
 * Resolves a persisted reference to a display URL. Kept async and fallback-tolerant to match the
 * previous signature, so callers such as `hydrateCanvasImages` are unchanged.
 */
export async function resolveImageUrl(storageKey?: string, fallback = "", variant: FileVariant = "original") {
    if (!storageKey) return fallback;
    return fileUrl(storageKey, variant);
}

/** Thumbnail variant for lists and canvas nodes; avoids pulling the original for every tile. */
export function imageThumbUrl(storageKey?: string, fallback = "") {
    return storageKey ? fileUrl(storageKey, "thumb") : fallback;
}

export async function getImageBlob(storageKey: string) {
    const response = await fetch(fileUrl(storageKey), { credentials: "include" });
    if (!response.ok) return null;
    return response.blob();
}

/** Providers and exports that need inline bytes go through here. */
export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }, options?: ImageReadOptions) {
    if (image.dataUrl?.startsWith("data:")) return image.dataUrl;
    const source = image.storageKey ? fileUrl(image.storageKey) : image.url || image.dataUrl || "";
    if (!source) return "";
    if (source.startsWith("data:")) return source;
    return blobToDataUrl(await fetchAsBlob(source, options));
}

export async function loadImageMeta(url: string, options?: ImageReadOptions, timeoutMs = IMAGE_DECODE_TIMEOUT_MS) {
    return new Promise<{ width: number; height: number } | null>((resolve) => {
        const image = new Image();
        const done = (value: { width: number; height: number } | null) => {
            window.clearTimeout(timer);
            resolve(value);
        };
        const timer = window.setTimeout(() => done(null), timeoutMs);
        image.onload = () => done({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => done(null);
        options?.signal?.addEventListener("abort", () => done(null), { once: true });
        image.src = url;
    });
}

/** Recovers the storage key from a server file URL such as `/api/files/image%3Aabc`. */
export function storageKeyFromUrl(url: string) {
    const match = url.match(/^\/api\/files\/([^?/]+)/);
    if (!match) return "";
    const decoded = decodeURIComponent(match[1]);
    return /^(image|video|audio|file|video-reference|audio-reference):/.test(decoded) ? decoded : "";
}

async function fetchAsBlob(source: string, options?: ImageReadOptions) {
    const response = await fetch(source, { signal: options?.signal, credentials: source.startsWith("/api/") ? "include" : "same-origin" });
    if (!response.ok) throw new Error(i18n.t("common.imageReadFailed"));
    return response.blob();
}

export function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("common.imageReadFailed")));
        reader.readAsDataURL(blob);
    });
}

/**
 * Reference collection is still useful client-side for building the reference list sent to the API,
 * so the walker stays; the server owns actual garbage collection now.
 */
export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (typeof value === "string") {
        if (value.startsWith("image:")) keys.add(value);
        return keys;
    }
    if (Array.isArray(value)) {
        value.forEach((item) => collectImageStorageKeys(item, keys));
        return keys;
    }
    if (value && typeof value === "object") {
        Object.values(value).forEach((item) => collectImageStorageKeys(item, keys));
    }
    return keys;
}
