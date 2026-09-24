import { apiDelete, apiGet, apiPatch, apiPost, type Paginated } from "./client";
import type { WalletSnapshot } from "./account";
import type { ModelFeatures } from "@/lib/model-features";

export type ResellerApplicationStatus = "none" | "pending" | "approved" | "rejected" | "suspended";

export type ResellerProfileForm = {
    companyName: string;
    contactEmail: string;
    website: string;
    useCase: string;
};

export type ResellerStatus = {
    status: ResellerApplicationStatus;
    /** Console access is available to any enrolled account unless suspended. */
    canUseConsole: boolean;
    tierName: string | null;
    /** Signed surcharge as the admin configured it, e.g. "-0.100000". */
    surcharge: string;
    /** Coefficient used in billing, i.e. 1 + surcharge. */
    multiplier: string;
    rejectReason: string;
    appliedAt: string | null;
    reviewedAt: string | null;
    profile: ResellerProfileForm | null;
};

export type ApiToken = {
    id: string;
    name: string;
    keyPrefix: string;
    keyTail: string;
    status: "active" | "disabled";
    quotaLimit: string | null;
    quotaUsed: string;
    rpmLimit: number;
    concurrencyLimit: number;
    modelScope: string[];
    allowedIps: string[];
    expiresAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
};

export type ApiTokenOption = { id: string; name: string; keyPrefix: string; keyTail: string };

export type CreateApiTokenInput = {
    name?: string;
    quotaLimit?: string;
    rpmLimit?: number;
    concurrencyLimit?: number;
    modelScope?: string[];
    allowedIps?: string[];
    expiresAt?: string;
};

export type UpdateApiTokenInput = CreateApiTokenInput & {
    status?: "active" | "disabled";
    clearQuotaLimit?: boolean;
    clearExpiresAt?: boolean;
};

export type ApiLogEntry = {
    id: string;
    createdAt: string;
    endpoint: string;
    capability: string;
    model: string;
    status: "success" | "failed";
    httpStatus: number;
    errorCode: string;
    quantity: number;
    inputTokens: number;
    outputTokens: number;
    billedAmount: string;
    multiplier: string;
    latencyMs: number;
    clientIp: string;
    taskId: string | null;
    apiKeyId: string | null;
    apiKeyName: string | null;
};

export type ResellerModel = {
    id: string;
    qualifiedId: string;
    displayName: string;
    capability: "image" | "video" | "text" | "audio";
    billingMode: "per_image" | "per_second" | "per_call" | "per_token";
    unitPrice: string;
    listUnitPrice: string;
    minCharge: string;
    extraReferencePrice: string;
    specPrices: Record<string, string>;
    tokenPrices: NonNullable<import("./models").PublicModel["tokenPrices"]>;
    features: ModelFeatures;
};

export type DaySummary = {
    requests: number;
    failedRequests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    billedAmount: string;
};

export type RealtimeThroughput = { qps: number; rpm: number; tpm: number; tasks: number };

export type ResellerOverview = {
    today: DaySummary;
    yesterday: DaySummary;
    tokens: { total: number; active: number; activeToday: number; activeYesterday: number };
    throughput: RealtimeThroughput;
    balance: string;
    recent: Array<{
        id: string;
        createdAt: string;
        capability: string;
        model: string;
        status: "success" | "failed";
        inputTokens: number;
        outputTokens: number;
        billedAmount: string;
    }>;
    distribution: Array<{ model: string; requests: number; tokens: number; amount: string }>;
    distributionDays: number;
};

export type ResellerProfile = ResellerStatus & {
    username: string;
    joinedAt: string | null;
    wallet: WalletSnapshot;
    lifetime: { requests: number; inputTokens: number; outputTokens: number; billedAmount: string };
};

export type ApiLogQuery = {
    page: number;
    pageSize: number;
    from?: string;
    to?: string;
    model?: string;
    apiKeyId?: string;
    status?: "success" | "failed";
};

export const resellerApi = {
    apply: (body: Partial<ResellerProfileForm>) => apiPost<ResellerStatus>("/reseller/apply", body),
    status: () => apiGet<ResellerStatus>("/reseller/status"),

    overview: (days: number) => apiGet<ResellerOverview>("/reseller/overview", { params: { days } }),
    realtime: () => apiGet<RealtimeThroughput>("/reseller/realtime"),

    tokens: (params: { page: number; pageSize: number }) => apiGet<Paginated<ApiToken>>("/reseller/tokens", { params }),
    tokenOptions: () => apiGet<{ items: ApiTokenOption[] }>("/reseller/tokens/options"),
    /** The plaintext key is returned exactly once, here. It is never retrievable again. */
    createToken: (body: CreateApiTokenInput) => apiPost<{ key: ApiToken; plaintext: string }>("/reseller/tokens", body),
    updateToken: (id: string, body: UpdateApiTokenInput) => apiPatch<ApiToken>(`/reseller/tokens/${id}`, body),
    resetTokenQuota: (id: string) => apiPost<ApiToken>(`/reseller/tokens/${id}/reset-quota`),
    removeToken: (id: string) => apiDelete<{ removed: number }>(`/reseller/tokens/${id}`),

    logs: (params: ApiLogQuery) => apiGet<Paginated<ApiLogEntry>>("/reseller/logs", { params }),
    models: () => apiGet<{ multiplier: string; models: ResellerModel[] }>("/reseller/models"),
    profile: () => apiGet<ResellerProfile>("/reseller/profile"),
    updateProfile: (body: ResellerProfileForm) => apiPatch<ResellerProfile>("/reseller/profile", body),
};

/** The downstream Base URL, derived from wherever the console itself is served. */
export function apiBaseUrl() {
    if (typeof window === "undefined") return "/v1";
    return `${window.location.origin}/v1`;
}
