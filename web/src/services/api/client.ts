import axios, { type AxiosRequestConfig } from "axios";

/**
 * Single entry point for every backend call. Cookies carry the session, so requests must always send
 * credentials; the server is same-origin behind nginx at /api.
 */
export const apiClient = axios.create({
    baseURL: "/api",
    withCredentials: true,
    timeout: 0,
});

export type ApiErrorBody = {
    statusCode: number;
    /** Stable machine-readable code, e.g. INSUFFICIENT_BALANCE, NO_USABLE_CHANNEL. */
    code: string;
    message: string;
    details?: unknown;
};

export class ApiError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly status: number,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

/** Notified when the server reports the session is gone, so the app can show the login page. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void) {
    onUnauthorized = handler;
}

apiClient.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
        if (axios.isCancel(error)) return Promise.reject(error);
        if (!axios.isAxiosError(error)) return Promise.reject(error);

        const status = error.response?.status ?? 0;
        const body = error.response?.data as ApiErrorBody | undefined;
        // 401 anywhere means the session expired or was revoked; surface it once, globally.
        if (status === 401) onUnauthorized?.();
        if (!error.response) return Promise.reject(new ApiError("NETWORK_ERROR", "无法连接服务器，请检查网络后重试", 0));
        return Promise.reject(new ApiError(body?.code || "HTTP_ERROR", body?.message || "请求失败", status, body?.details));
    },
);

export async function apiGet<T>(url: string, config?: AxiosRequestConfig) {
    const response = await apiClient.get<T>(url, config);
    return response.data;
}

export async function apiPost<T>(url: string, body?: unknown, config?: AxiosRequestConfig) {
    const response = await apiClient.post<T>(url, body, config);
    return response.data;
}

export async function apiPatch<T>(url: string, body?: unknown, config?: AxiosRequestConfig) {
    const response = await apiClient.patch<T>(url, body, config);
    return response.data;
}

export async function apiDelete<T>(url: string, body?: unknown, config?: AxiosRequestConfig) {
    const response = await apiClient.delete<T>(url, { ...config, data: body });
    return response.data;
}

/**
 * Money-moving endpoints require an idempotency key so a double-click or a retry cannot charge twice.
 * The key is derived per call site and reused across retries of the same logical action.
 */
export function idempotencyHeaders(key: string) {
    return { headers: { "Idempotency-Key": key } };
}

export function newIdempotencyKey() {
    return crypto.randomUUID();
}

export type Paginated<T> = { items: T[]; total: number; page: number; pageSize: number };
