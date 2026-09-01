import { fileUrl, uploadFile } from "@/services/api/files";

export type UploadedFile = {
    url: string;
    storageKey: string;
    bytes: number;
    mimeType: string;
    width?: number;
    height?: number;
    durationMs?: number;
};

/** Video and audio counterpart of image-storage; same server-backed contract. */
export async function uploadMediaFile(input: Blob | string, prefix = "file"): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetch(input, { credentials: "same-origin" })).blob() : input;
    const stored = await uploadFile(blob, `${prefix}.bin`);
    return {
        url: fileUrl(stored.storageKey),
        storageKey: stored.storageKey,
        bytes: stored.bytes,
        mimeType: stored.mimeType,
        width: stored.width ?? undefined,
        height: stored.height ?? undefined,
        durationMs: stored.durationMs ?? undefined,
    };
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    return fileUrl(storageKey);
}

export async function getMediaBlob(storageKey: string) {
    const response = await fetch(fileUrl(storageKey), { credentials: "include" });
    return response.ok ? response.blob() : null;
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (typeof value === "string") {
        if (/^(video|audio|file|video-reference|audio-reference):/.test(value)) keys.add(value);
        return keys;
    }
    if (Array.isArray(value)) {
        value.forEach((item) => collectMediaStorageKeys(item, keys));
        return keys;
    }
    if (value && typeof value === "object") {
        Object.values(value).forEach((item) => collectMediaStorageKeys(item, keys));
    }
    return keys;
}
