const STORAGE_KEY_PATTERN = /^(image|video|audio|file|video-reference|audio-reference):/;

/**
 * Rewrites storage keys inside an arbitrary payload.
 *
 * Storage keys used to be generated in the browser, so an exported archive could be restored under
 * its original keys. The server now issues them, which means an import has to upload each file, get
 * a fresh key, and rewrite every reference — including the display URLs that embed the key.
 */
export function remapStorageKeys<T>(value: T, mapping: Map<string, string>): T {
    if (!mapping.size) return value;

    if (typeof value === "string") {
        const mapped = mapping.get(value);
        if (mapped) return mapped as unknown as T;
        // Display URLs such as /api/files/image%3Aabc also embed the key.
        for (const [from, to] of mapping) {
            if (value.includes(encodeURIComponent(from))) return value.replaceAll(encodeURIComponent(from), encodeURIComponent(to)) as unknown as T;
            if (value.includes(from)) return value.replaceAll(from, to) as unknown as T;
        }
        return value;
    }

    if (Array.isArray(value)) return value.map((item) => remapStorageKeys(item, mapping)) as unknown as T;

    if (value && typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) result[key] = remapStorageKeys(item, mapping);
        return result as T;
    }

    return value;
}

export function isStorageKey(value: string) {
    return STORAGE_KEY_PATTERN.test(value);
}
