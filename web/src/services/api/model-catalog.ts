import { apiDelete, apiGet, apiPatch, apiPost } from "./client";

export type ModelBadgeTone = "primary" | "neutral" | "warning";
export type ModelBadge = { key: string; label: string; tone?: ModelBadgeTone };

export type ModelCatalogGroup = { id: string; key: string; name: string; description: string; sortOrder: number };
export type ModelCatalogEntry = { modelValue: string; groupId: string | null; summary: string; description: string; badges: ModelBadge[]; sortOrder: number };

export type ModelCatalogPublic = { groups: ModelCatalogGroup[]; models: ModelCatalogEntry[] };

export type AdminModelGroup = ModelCatalogGroup & { visible: boolean; createdAt: string; updatedAt: string };
export type AdminModelEntry = ModelCatalogEntry & { id: string; visible: boolean; createdAt: string; updatedAt: string };
export type AdminModelCatalog = { groups: AdminModelGroup[]; models: AdminModelEntry[]; badgePresets: ModelBadge[] };

export type ModelGroupWrite = { key: string; name: string; description?: string; sortOrder?: number; visible?: boolean };
export type ModelEntryWrite = { modelValue: string; groupId?: string | null; summary?: string; description?: string; badges?: ModelBadge[]; sortOrder?: number; visible?: boolean };

/** 工作台模型选择弹窗使用的公开数据。 */
export const modelCatalogApi = {
    get: () => apiGet<ModelCatalogPublic>("/models/catalog"),
};

/** 后台「模型介绍」管理。 */
export const adminModelCatalogApi = {
    get: () => apiGet<AdminModelCatalog>("/admin/model-catalog"),
    createGroup: (body: ModelGroupWrite) => apiPost<AdminModelGroup>("/admin/model-catalog/groups", body),
    updateGroup: (id: string, body: ModelGroupWrite) => apiPatch<AdminModelGroup>(`/admin/model-catalog/groups/${id}`, body),
    removeGroup: (id: string) => apiDelete<{ removed: boolean; ungrouped: number }>(`/admin/model-catalog/groups/${id}`),
    createEntry: (body: ModelEntryWrite) => apiPost<AdminModelEntry>("/admin/model-catalog/presentations", body),
    updateEntry: (id: string, body: ModelEntryWrite) => apiPatch<AdminModelEntry>(`/admin/model-catalog/presentations/${id}`, body),
    removeEntry: (id: string) => apiDelete<{ removed: boolean }>(`/admin/model-catalog/presentations/${id}`),
};
