import axios from "axios";
import { AppError } from "../../../common/errors";

/** Never serialize Axios config/headers or an upstream HTML error page into a task/log. */
export function providerError(error: unknown) {
    if (error instanceof AppError || !axios.isAxiosError(error)) return error;
    const payload = error.response?.data;
    const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    const detail = record.error && typeof record.error === "object" ? record.error : record;
    const raw = typeof detail.message === "string" ? detail.message : typeof record.msg === "string" ? record.msg : "Upstream request failed";
    const message = sanitizeProviderMessage(raw, error.config?.headers?.Authorization);
    const status = error.response?.status ?? 502;
    const code = typeof detail.code === "string" && /^[\w.-]+$/.test(detail.code) ? detail.code : "upstream_request_failed";
    const param = typeof detail.param === "string" && /^[\w.[\]-]+$/.test(detail.param) ? detail.param : undefined;
    return new AppError(status === 400 || status === 422 ? 400 : 502, "PROVIDER_ERROR", `Upstream HTTP ${status}: ${message}`, { upstreamStatus: status, upstreamCode: code, param });
}

export function sanitizeProviderMessage(message: string, authorization?: unknown) {
    let value = message;
    if (typeof authorization === "string") {
        const secret = authorization.replace(/^Bearer\s+/i, "");
        if (secret) value = value.split(secret).join("[REDACTED]");
    }
    return value.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
        .replace(/\bsk-[\w-]+/g, "[REDACTED]")
        .replace(/https?:\/\/[^\s<>"']+/gi, "[URL]")
        .replace(/data:[^\s]+/gi, "[DATA]")
        .slice(0, 1800);
}

export function providerFailureDetails(error: unknown) {
    if (!(error instanceof AppError)) return undefined;
    const body = error.getResponse() as { code?: string; details?: { upstreamStatus?: number; upstreamCode?: string; param?: string } };
    return body.code === "PROVIDER_ERROR" ? body.details : undefined;
}
