import { apiClient, apiGet } from "./client";

export type StoredFile = {
    id: string;
    storageKey: string;
    mimeType: string;
    bytes: number;
    width: number | null;
    height: number | null;
    durationMs: number | null;
    url: string;
    thumbUrl: string;
    mediumUrl: string;
};

export type FileVariant = "original" | "thumb" | "medium";

/**
 * Files live on the server; the browser only ever holds URLs. The server answers with a redirect to a
 * signed URL (S3) or an nginx internal redirect (local disk), so bytes never pass through Node.
 */
export function fileUrl(storageKey: string, variant: FileVariant = "original") {
    const params = new URLSearchParams();
    if (variant !== "original") params.set("variant", variant);
    // Bust the empty immutable responses served before local-disk files were streamed without nginx.
    params.set("v", "2");
    return `/api/files/${encodeURIComponent(storageKey)}?${params.toString()}`;
}

export async function uploadFile(input: Blob | File, fileName?: string) {
    const form = new FormData();
    form.append("file", input, fileName ?? (input instanceof File ? input.name : "upload.bin"));
    const response = await apiClient.post<StoredFile>("/files", form);
    return response.data;
}

/** Uploads a data URL, which is how references arrive from paste and drag-and-drop. */
export async function uploadDataUrl(dataUrl: string, fileName = "upload.png") {
    const response = await fetch(dataUrl);
    return uploadFile(await response.blob(), fileName);
}

export function fetchFileMeta(id: string) {
    return apiGet<StoredFile>(`/files/meta/${id}`);
}

/** Reads a stored file back as a data URL, for providers or exports that need inline bytes. */
export async function fileToDataUrl(storageKey: string) {
    const response = await fetch(fileUrl(storageKey), { credentials: "include" });
    if (!response.ok) throw new Error("读取文件失败");
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(blob);
    });
}
