import axios from "axios";
import { AppError } from "../../../common/errors";

/**
 * What a customer sees when the *upstream* account is out of credit.
 *
 * The relay's own wording reads like an invoice from a supplier the customer has never heard of
 * (「账户余额不足，视频生成按秒预扣冻结：0.3Dollar/秒 × 15秒 = 4.5Dollar」), and the bare phrase
 * 「账户余额不足」 makes people think their own wallet is empty and stop trying. The real reason is
 * preserved in `details.upstreamMessage` for admins.
 */
export const UPSTREAM_MAINTENANCE_MESSAGE = "平台正在升级基础设施预计2小时内完成。感谢您使用";

/** Credit/quota wording from a relay. Only ever applied to upstream messages, never to a wallet error. */
const RELAY_CREDIT_WORDS = /insufficient|not enough|no available|exhausted|out of (?:credit|balance|quota)|balance|quota|credit|余额|额度|欠费/i;

/** Upstream 402, or credit wording inside a message our own code prefixed with `Upstream HTTP`. */
/** Credit wording inside a bare upstream response body (`insufficient_user_quota`, 「账户余额不足」…). */
export function relayCreditWording(message: string) {
    return RELAY_CREDIT_WORDS.test(message);
}

/** Upstream 402, or credit wording inside a message our own code prefixed with `Upstream HTTP`. */
export function isUpstreamCreditFailure(message: string, upstreamStatus?: number) {
    if (upstreamStatus === 402) return true;
    return /^upstream http/i.test(message.trim()) && relayCreditWording(message);
}

/** Provider-pool failures ("PiAPI 账号池…") name the same cause: our own upstream accounts are broke. */
export function isUpstreamAccountFailure(message: string) {
    return /账号池/.test(message);
}

/**
 * Customer-visible text for a failed task. The customer's own wallet error
 * (`余额不足，请先充值`) never matches: it is not prefixed with `Upstream HTTP` and names no account
 * pool, so it keeps telling them to top up.
 */
export function friendlyUpstreamError(message: string, upstreamStatus?: number) {
    return isUpstreamCreditFailure(message, upstreamStatus) || isUpstreamAccountFailure(message)
        ? UPSTREAM_MAINTENANCE_MESSAGE
        : message;
}

/** Never serialize Axios config/headers or an upstream HTML error page into a task/log. */
export function providerError(error: unknown) {
    if (error instanceof AppError || !axios.isAxiosError(error)) return error;
    const payload = error.response?.data;
    const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    const detail = record.error && typeof record.error === "object" ? record.error : record;
    const raw = typeof detail.message === "string" ? detail.message : typeof record.msg === "string" ? record.msg : "Upstream request failed";
    const status = error.response?.status ?? 502;
    const sanitized = sanitizeProviderMessage(raw, error.config?.headers?.Authorization);
    const credit = status === 402 || relayCreditWording(raw);
    const message = credit ? UPSTREAM_MAINTENANCE_MESSAGE : `Upstream HTTP ${status}: ${sanitized}`;
    const code = typeof detail.code === "string" && /^[\w.-]+$/.test(detail.code) ? detail.code : "upstream_request_failed";
    const param = typeof detail.param === "string" && /^[\w.[\]-]+$/.test(detail.param) ? detail.param : undefined;
    // Customers get the maintenance wording; admins keep the sanitized relay text in the details.
    return new AppError(status === 400 || status === 422 ? 400 : 502, "PROVIDER_ERROR", message, {
        upstreamStatus: status,
        upstreamCode: code,
        param,
        ...(credit ? { upstreamMessage: sanitized } : {}),
    });
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
