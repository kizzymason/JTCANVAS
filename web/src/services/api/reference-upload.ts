import { uploadDataUrl } from "@/services/api/files";
import type { ReferenceImage } from "@/types/image";

/**
 * Reference images must exist on the server before a generation task can use them, because the
 * worker reads their bytes and the browser never talks to a provider directly.
 *
 * Anything already carrying a `storageKey` is passed through; inline data URLs are uploaded once.
 */
export async function ensureReferenceKeys(references: ReferenceImage[], signal?: AbortSignal): Promise<string[]> {
    const keys: string[] = [];
    for (const reference of references) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (reference.storageKey) {
            keys.push(reference.storageKey);
            continue;
        }
        const source = reference.dataUrl || reference.url || "";
        if (!source) continue;
        const stored = await uploadDataUrl(source, reference.name || "reference.png");
        keys.push(stored.storageKey);
    }
    return keys;
}
