import { uploadDataUrl } from "@/services/api/files";

export type ReferenceUploadSource = {
    storageKey?: string;
    dataUrl?: string;
    url?: string;
    name?: string;
};

/**
 * Reference media must exist on the server before a generation task can use them, because the
 * worker reads their bytes and the browser never talks to a provider directly.
 *
 * Public http(s) URLs are passed through for providers like PiAPI that fetch the image themselves.
 * Anything already carrying a `storageKey` is passed through; inline data URLs are uploaded once.
 */
export async function ensureReferenceKeys(references: ReferenceUploadSource[], signal?: AbortSignal): Promise<string[]> {
    const keys: string[] = [];
    for (const reference of references) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const source = reference.dataUrl || reference.url || "";
        if (isPublicHttpUrl(source) && !isAppFileUrl(source)) {
            keys.push(source);
            continue;
        }
        if (reference.storageKey) {
            keys.push(reference.storageKey);
            continue;
        }
        if (!source) continue;
        const stored = await uploadDataUrl(source, reference.name || "reference");
        keys.push(stored.storageKey);
    }
    return keys;
}

/** Clipboard / paste text may contain one or more public image URLs. */
export function publicImageUrlsFromText(text: string) {
    const matches = text.match(/https?:\/\/[^\s<>"'，,]+/gi) ?? [];
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const raw of matches) {
        const value = raw.replace(/[)\].,;]+$/g, "");
        if (!isPublicHttpUrl(value) || isAppFileUrl(value) || seen.has(value)) continue;
        seen.add(value);
        urls.push(value);
    }
    return urls;
}

export function fileNameFromImageUrl(value: string) {
    try {
        const pathname = decodeURIComponent(new URL(value).pathname);
        const name = pathname.split("/").filter(Boolean).pop() || "reference.png";
        return name.slice(0, 128);
    } catch {
        return "reference.png";
    }
}

export function isPublicHttpUrl(value: string) {
    try {
        const url = new URL(value.trim());
        if (url.protocol !== "http:" && url.protocol !== "https:") return false;
        const host = url.hostname.toLowerCase();
        if (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return false;
        if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
        return true;
    } catch {
        return false;
    }
}

function isAppFileUrl(value: string) {
    try {
        const url = new URL(value, "http://local.invalid");
        return url.pathname.startsWith("/api/files/");
    } catch {
        return false;
    }
}
