import localforage from "localforage";

import { uploadFile } from "@/services/api/files";
import { createAsset, createProject } from "@/services/api/content";
import { remapStorageKeys } from "@/lib/canvas/storage-key-remap";

export type MigrationProgress = {
    stage: "scanning" | "files" | "projects" | "assets" | "done";
    current: number;
    total: number;
    message: string;
};

export type MigrationSummary = {
    projects: number;
    assets: number;
    files: number;
    skipped: number;
};

/** The IndexedDB layout the browser-only version of the app used. */
const legacyState = localforage.createInstance({ name: "infinite-canvas", storeName: "app_state" });
const legacyImages = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const legacyMedia = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });

const CANVAS_KEY = "infinite-canvas:canvas_store";
const ASSET_KEY = "infinite-canvas:asset_store";

type LegacyProject = { id: string; title: string; nodes?: unknown[]; connections?: unknown[]; chatSessions?: unknown[]; activeChatId?: string | null; backgroundMode?: string; showImageInfo?: boolean; viewport?: unknown };
type LegacyAsset = {
    id: string;
    kind: "text" | "image" | "video";
    title: string;
    coverUrl?: string;
    tags?: string[];
    source?: string;
    note?: string;
    metadata?: Record<string, unknown>;
    data?: { content?: string; storageKey?: string; width?: number; height?: number; bytes?: number; mimeType?: string };
};

/** Reports what a migration would move, without changing anything. */
export async function inspectLocalData() {
    const [projects, assets, imageKeys, mediaKeys] = await Promise.all([readProjects(), readAssets(), legacyImages.keys(), legacyMedia.keys()]);
    return { projects: projects.length, assets: assets.length, files: imageKeys.length + mediaKeys.length };
}

/**
 * One-time upload of browser-local data into the signed-in cloud account.
 *
 * Files are uploaded first so their new server keys are known, then every reference inside the
 * project and asset payloads is rewritten before the record is created. Nothing local is deleted:
 * a failed or partial run can simply be retried, at the cost of duplicates the user can remove.
 */
export async function migrateLocalDataToCloud(onProgress?: (progress: MigrationProgress) => void): Promise<MigrationSummary> {
    const report = (progress: MigrationProgress) => onProgress?.(progress);
    report({ stage: "scanning", current: 0, total: 0, message: "读取本地数据" });

    const [projects, assets] = await Promise.all([readProjects(), readAssets()]);
    const summary: MigrationSummary = { projects: 0, assets: 0, files: 0, skipped: 0 };

    // Only migrate blobs that something actually references, so orphans are not carried over.
    const referenced = new Set<string>([...collectKeys(projects), ...collectKeys(assets)]);
    const mapping = new Map<string, string>();
    let index = 0;

    for (const storageKey of referenced) {
        index += 1;
        report({ stage: "files", current: index, total: referenced.size, message: `上传文件 ${index}/${referenced.size}` });
        const blob = (await legacyImages.getItem<Blob>(storageKey)) ?? (await legacyMedia.getItem<Blob>(storageKey));
        if (!blob) {
            summary.skipped += 1;
            continue;
        }
        try {
            const stored = await uploadFile(blob, `${storageKey.replace(/[^a-zA-Z0-9]/g, "_")}.bin`);
            mapping.set(storageKey, stored.storageKey);
            summary.files += 1;
        } catch {
            summary.skipped += 1;
        }
    }

    index = 0;
    for (const project of projects) {
        index += 1;
        report({ stage: "projects", current: index, total: projects.length, message: `上传画布 ${index}/${projects.length}` });
        const remapped = remapStorageKeys(project, mapping);
        try {
            await createProject({
                title: remapped.title || "导入的画布",
                data: {
                    nodes: remapped.nodes ?? [],
                    connections: remapped.connections ?? [],
                    chatSessions: remapped.chatSessions ?? [],
                    activeChatId: remapped.activeChatId ?? null,
                    backgroundMode: remapped.backgroundMode ?? "lines",
                    showImageInfo: remapped.showImageInfo ?? false,
                    viewport: remapped.viewport ?? { x: 0, y: 0, k: 1 },
                },
            });
            summary.projects += 1;
        } catch {
            summary.skipped += 1;
        }
    }

    index = 0;
    for (const asset of assets) {
        index += 1;
        report({ stage: "assets", current: index, total: assets.length, message: `上传素材 ${index}/${assets.length}` });
        const remapped = remapStorageKeys(asset, mapping);
        try {
            await createAsset({
                kind: remapped.kind === "video" ? "video" : remapped.kind === "image" ? "image" : "text",
                title: remapped.title || "导入的素材",
                content: remapped.data?.content ?? "",
                tags: remapped.tags ?? [],
                source: remapped.source ?? "",
                note: remapped.note ?? "",
                // The new server key travels in metadata, which is where the asset store reads it from.
                metadata: { ...(remapped.metadata ?? {}), storageKey: remapped.data?.storageKey, width: remapped.data?.width, height: remapped.data?.height, bytes: remapped.data?.bytes, mimeType: remapped.data?.mimeType },
            });
            summary.assets += 1;
        } catch {
            summary.skipped += 1;
        }
    }

    report({ stage: "done", current: 1, total: 1, message: "迁移完成" });
    return summary;
}

async function readProjects(): Promise<LegacyProject[]> {
    const raw = await legacyState.getItem<string>(CANVAS_KEY);
    if (!raw) return [];
    try {
        return (JSON.parse(raw).state?.projects ?? []) as LegacyProject[];
    } catch {
        return [];
    }
}

async function readAssets(): Promise<LegacyAsset[]> {
    const raw = await legacyState.getItem<string>(ASSET_KEY);
    if (!raw) return [];
    try {
        return (JSON.parse(raw).state?.assets ?? []) as LegacyAsset[];
    } catch {
        return [];
    }
}

function collectKeys(value: unknown, keys = new Set<string>()) {
    if (typeof value === "string") {
        if (/^(image|video|audio|file|video-reference|audio-reference):/.test(value)) keys.add(value);
        return keys;
    }
    if (Array.isArray(value)) {
        value.forEach((item) => collectKeys(item, keys));
        return keys;
    }
    if (value && typeof value === "object") {
        Object.values(value).forEach((item) => collectKeys(item, keys));
    }
    return keys;
}
