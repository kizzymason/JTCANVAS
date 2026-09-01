import { apiDelete, apiGet, apiPatch, apiPost, type Paginated } from "./client";

export type ProjectSummary = {
    id: string;
    title: string;
    version: number;
    nodeCount: number;
    coverFileId: string | null;
    createdAt: string;
    updatedAt: string;
};

export type ProjectRecord = ProjectSummary & {
    /** Nodes, connections, chat sessions and view preferences. */
    data: Record<string, unknown>;
};

export type AssetKind = "text" | "image" | "video" | "audio";

export type AssetRecord = {
    id: string;
    kind: AssetKind;
    title: string;
    content: string;
    fileId: string | null;
    coverFileId: string | null;
    tags: string[];
    source: string;
    note: string;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
};

export function fetchProjects(params: { page: number; pageSize: number }) {
    return apiGet<Paginated<ProjectSummary>>("/projects", { params });
}

export function fetchProject(id: string) {
    return apiGet<ProjectRecord>(`/projects/${id}`);
}

export function createProject(body: { title: string; data?: Record<string, unknown> }) {
    return apiPost<ProjectRecord>("/projects", body);
}

/**
 * Saves a canvas. `version` must be the value loaded with the project; the server rejects a stale one
 * with VERSION_CONFLICT rather than overwriting a newer save from another tab or device.
 */
export function saveProject(id: string, body: { version: number; title?: string; data?: Record<string, unknown> }) {
    return apiPatch<ProjectRecord>(`/projects/${id}`, body);
}

export function deleteProjects(ids: string[]) {
    return apiDelete<{ removed: number }>("/projects", { ids });
}

export function fetchAssets(params: { page: number; pageSize: number; kind?: AssetKind; keyword?: string }) {
    return apiGet<Paginated<AssetRecord>>("/assets", { params });
}

export type AssetWriteBody = {
    kind: AssetKind;
    title: string;
    content?: string;
    fileId?: string;
    coverFileId?: string;
    storageKey?: string;
    tags?: string[];
    source?: string;
    note?: string;
    metadata?: Record<string, unknown>;
};

export function createAsset(body: AssetWriteBody) {
    return apiPost<AssetRecord>("/assets", body);
}

export function updateAsset(id: string, body: Partial<AssetWriteBody>) {
    return apiPatch<AssetRecord>(`/assets/${id}`, body);
}

export function deleteAssets(ids: string[]) {
    return apiDelete<{ removed: number }>("/assets", { ids });
}
