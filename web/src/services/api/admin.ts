import { apiGet, apiPatch, apiPost, apiDelete, type Paginated } from "./client";
import type { BillingMode, ModelCapability } from "./models";

export type AdminOverview = {
    users: { total: number; active: number };
    wallet: { balance: string; frozen: string; spent: string };
    tasks: { total: number; running: number; failed7d: number };
    revenue: string;
};

export type AdminUser = {
    id: string;
    username: string;
    role: "user" | "admin";
    status: "active" | "disabled";
    displayName: string;
    lastLoginAt: string | null;
    createdAt: string;
    balance: string | null;
    frozen: string | null;
    totalSpent: string | null;
    totalRecharged: string | null;
};

export type AdminModelPrice = {
    id: string;
    billingMode: BillingMode;
    spec: string | null;
    unitPrice: string;
    extraReferencePrice: string;
    minCharge: string;
};

export type AdminChannelModel = {
    id: string;
    name: string;
    displayName: string;
    capability: ModelCapability;
    enabled: boolean;
    hasScript: boolean;
    features?: {
        resolutions: Array<"1K" | "2K" | "4K">;
        maxCount: number;
        supportsTransparent: boolean;
        aspectRatios: string[];
        aspectPresets?: Array<{ ratio: string; label: string; sizes: Partial<Record<"1K" | "2K" | "4K", string>> }>;
        videoResolutions: string[];
        maxSeconds: number;
    };
    prices: AdminModelPrice[];
};

export type AdminChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiFormat: "openai" | "gemini" | "piapi";
    enabled: boolean;
    priority: number;
    /** The key itself is never returned; this only says whether one is stored. */
    hasApiKey: boolean;
    createdAt: string;
    models: AdminChannelModel[];
};

export type AdminTask = {
    id: string;
    username: string | null;
    capability: ModelCapability;
    modelName: string;
    status: string;
    quantity: number;
    succeededCount: number;
    estimatedCost: string;
    actualCost: string;
    error: string;
    createdAt: string;
    finishedAt: string | null;
};

export type AdminOrder = { id: string; orderNo: string; username: string | null; amount: string; status: string; paymentProvider: string; paidAt: string | null; createdAt: string };
export type AdminLedgerEntry = { id: string; username: string | null; type: string; amount: string; balanceAfter: string; note: string; createdAt: string };
export type AdminReconcileMismatch = { userId: string; username: string; expected: string; actual: string };
export type AdminCardBatch = { id: string; name: string; faceValue: string; quantity: number; usedCount: number; voidCount: number; expiresAt: string | null; createdAt: string };
export type AdminCard = { id: string; code: string; faceValue: string; status: "unused" | "used" | "void"; redeemedAt: string | null; expiresAt: string | null };
export type AdminAuditLog = { id: string; actorName: string; action: string; targetType: string; targetId: string; before: unknown; after: unknown; ip: string; createdAt: string };
export type AdminPiapiAccount = { id: string; username: string; apiKeyMask: string; status: string; balanceUsd: string; usedCount: number; checkedAt: string | null; lastError: string };

export type SiteSettings = {
    registrationEnabled: boolean;
    newUserGiftAmount: string;
    siteName: string;
    rechargeNotice: string;
    imageGenerationEnabled: boolean;
    videoGenerationEnabled: boolean;
    agentEnabled: boolean;
};
export type ServiceSettings = {
    imageGenerationEnabled: boolean;
    videoGenerationEnabled: boolean;
    agentEnabled: boolean;
};
export type StorageSettings = {
    driver: "local" | "s3";
    s3: { endpoint: string; region: string; bucket: string; accessKeyId: string; forcePathStyle: boolean; publicBaseUrl: string; hasSecret?: boolean };
};

export const adminApi = {
    overview: () => apiGet<AdminOverview>("/admin/overview"),

    users: (params: { page: number; pageSize: number; keyword?: string; role?: string; status?: string }) => apiGet<Paginated<AdminUser>>("/admin/users", { params }),
    updateUser: (id: string, body: { role?: string; status?: string; displayName?: string; password?: string }) => apiPatch<{ user: AdminUser }>(`/admin/users/${id}`, body),
    deleteUsers: (ids: string[]) => apiPost<{ removed: number }>("/admin/users/delete", { ids }),
    adjustBalance: (id: string, body: { amount: string; note: string }) => apiPost<{ balance: string }>(`/admin/users/${id}/balance`, body),
    userLedger: (id: string, params: { page: number; pageSize: number }) => apiGet<Paginated<AdminLedgerEntry>>(`/admin/users/${id}/ledger`, { params }),

    channels: () => apiGet<AdminChannel[]>("/admin/channels"),
    createChannel: (body: Record<string, unknown>) => apiPost<{ id: string }>("/admin/channels", body),
    updateChannel: (id: string, body: Record<string, unknown>) => apiPatch<{ id: string }>(`/admin/channels/${id}`, body),
    deleteChannel: (id: string) => apiDelete<{ id: string }>(`/admin/channels/${id}`),
    upsertModel: (channelId: string, body: Record<string, unknown>) => apiPost<{ id: string }>(`/admin/channels/${channelId}/models`, body),
    deleteModel: (id: string) => apiDelete<{ id: string }>(`/admin/models/${id}`),
    upsertPrice: (modelId: string, body: Record<string, unknown>) => apiPost<{ id: string }>(`/admin/models/${modelId}/prices`, body),
    deletePrice: (id: string) => apiDelete<{ id: string }>(`/admin/prices/${id}`),

    tasks: (params: { page: number; pageSize: number; status?: string; userId?: string; keyword?: string; capability?: string }) => apiGet<Paginated<AdminTask>>("/admin/tasks", { params }),
    orders: (params: { page: number; pageSize: number }) => apiGet<Paginated<AdminOrder>>("/admin/orders", { params }),
    ledger: (params: { page: number; pageSize: number; keyword?: string; type?: string }) => apiGet<Paginated<AdminLedgerEntry>>("/admin/ledger", { params }),
    reconcile: () => apiGet<{ mismatches: AdminReconcileMismatch[] }>("/admin/reconcile"),

    cardBatches: (params: { page: number; pageSize: number; keyword?: string }) => apiGet<Paginated<AdminCardBatch>>("/admin/cards", { params }),
    createCards: (body: { name: string; faceValue: string; quantity: number; expiresAt?: string }) => apiPost<{ batchId: string; codes: string[] }>("/admin/cards", body),
    cards: (batchId: string, params: { page: number; pageSize: number; status?: string }) => apiGet<Paginated<AdminCard>>(`/admin/cards/${batchId}/items`, { params }),
    exportCards: (batchId: string) => apiGet<{ cards: Array<{ code: string; status: string }> }>(`/admin/cards/${batchId}/export`),
    voidCards: (ids: string[]) => apiPost<{ voided: number }>("/admin/cards/void", { ids }),
    deleteCards: (ids: string[]) => apiPost<{ removed: number }>("/admin/cards/delete", { ids }),
    deleteCardBatches: (ids: string[]) => apiPost<{ removed: number }>("/admin/cards/batches/delete", { ids }),

    settings: () => apiGet<{ site: SiteSettings; storage: StorageSettings }>("/admin/settings"),
    saveSite: (body: Pick<SiteSettings, "registrationEnabled" | "newUserGiftAmount" | "siteName" | "rechargeNotice">) => apiPatch<{ site: SiteSettings }>("/admin/settings/site", body),
    saveServices: (body: ServiceSettings) => apiPatch<{ site: SiteSettings }>("/admin/settings/services", body),
    saveStorage: (body: Record<string, unknown>) => apiPatch<Record<string, unknown>>("/admin/settings/storage", body),

    piapi: () => apiGet<AdminPiapiAccount[]>("/admin/piapi"),
    ensurePiapiChannel: () =>
        apiPost<{ id: string; name: string; created: boolean; modelsCreated: number; pricesInserted: number }>("/admin/piapi/ensure-channel"),
    importPiapi: (accounts: Array<{ username: string; apiKey: string }>) => apiPost<{ added: number; skipped: number }>("/admin/piapi/import", { accounts }),
    refreshPiapi: () => apiPost<{ refreshed: number }>("/admin/piapi/refresh"),
    setPiapiStatus: (ids: string[], status: "active" | "disabled") => apiPost<{ updated: number }>("/admin/piapi/status", { ids, status }),
    deletePiapi: (ids: string[]) => apiPost<{ removed: number }>("/admin/piapi/delete", { ids }),

    audit: (params: { page: number; pageSize: number; action?: string }) => apiGet<Paginated<AdminAuditLog>>("/admin/audit", { params }),
};
