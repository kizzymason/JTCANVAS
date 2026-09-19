import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * The error envelope every OpenAI-compatible client understands:
 * `{ "error": { message, type, code, param } }`. Downstream SDKs branch on `type` and `code`, so
 * these strings are part of our public contract and must stay stable.
 */
export type OpenAiErrorType =
    | "invalid_request_error"
    | "invalid_api_key"
    | "permission_denied"
    | "model_not_found"
    | "insufficient_quota"
    | "rate_limit_exceeded"
    | "server_error"
    | "upstream_error";

export type OpenAiErrorBody = {
    error: {
        message: string;
        type: OpenAiErrorType;
        code: string | null;
        param: string | null;
    };
};

export class OpenAiApiError extends HttpException {
    constructor(
        status: HttpStatus,
        type: OpenAiErrorType,
        code: string,
        message: string,
        param?: string,
        readonly headers: Record<string, string> = {},
    ) {
        super({ error: { message, type, code, param: param ?? null } } satisfies OpenAiErrorBody, status);
    }
}

export const invalidRequest = (message: string, code = "invalid_request", param?: string) =>
    new OpenAiApiError(HttpStatus.BAD_REQUEST, "invalid_request_error", code, message, param);

export const invalidApiKey = (message = "Incorrect API key provided.", code = "invalid_api_key") =>
    new OpenAiApiError(HttpStatus.UNAUTHORIZED, "invalid_api_key", code, message);

export const permissionDenied = (message: string, code = "permission_denied") => new OpenAiApiError(HttpStatus.FORBIDDEN, "permission_denied", code, message);

export const modelNotFound = (model: string) =>
    new OpenAiApiError(HttpStatus.NOT_FOUND, "model_not_found", "model_not_found", `The model \`${model}\` does not exist or you do not have access to it.`, "model");

export const insufficientQuota = (message = "You exceeded your current quota, please check your balance.", code = "insufficient_quota") =>
    new OpenAiApiError(HttpStatus.PAYMENT_REQUIRED, "insufficient_quota", code, message);

export const rateLimited = (message: string, code = "rate_limit_exceeded", headers: Record<string, string> = {}) =>
    new OpenAiApiError(HttpStatus.TOO_MANY_REQUESTS, "rate_limit_exceeded", code, message, undefined, headers);

export const upstreamError = (message: string, code = "upstream_error") => new OpenAiApiError(HttpStatus.BAD_GATEWAY, "upstream_error", code, message);

export const serverError = (message = "The server had an error while processing your request.", code = "internal_error") =>
    new OpenAiApiError(HttpStatus.INTERNAL_SERVER_ERROR, "server_error", code, message);

/** Maps the platform's internal `code` values onto the OpenAI vocabulary. */
const CODE_TO_TYPE: Record<string, OpenAiErrorType> = {
    UNAUTHORIZED: "invalid_api_key",
    FORBIDDEN: "permission_denied",
    SERVICE_DISABLED: "permission_denied",
    INSUFFICIENT_BALANCE: "insufficient_quota",
    TOO_MANY_ACTIVE_TASKS: "rate_limit_exceeded",
    TOO_MANY_REQUESTS: "rate_limit_exceeded",
    NO_USABLE_CHANNEL: "upstream_error",
    PROVIDER_ERROR: "upstream_error",
    NOT_FOUND: "invalid_request_error",
};

/**
 * The platform speaks Chinese to its own frontend, but `/v1` is a public English API consumed by
 * third-party SDKs. Internal messages are replaced here so a downstream developer never receives a
 * localized string they cannot act on.
 */
const CODE_TO_PUBLIC_MESSAGE: Record<string, string> = {
    NOT_FOUND: "The requested resource does not exist.",
    INSUFFICIENT_BALANCE: "Your account balance is insufficient to cover this request. Please top up and retry.",
    TOO_MANY_ACTIVE_TASKS: "Too many generation tasks are already running for this account. Please retry shortly.",
    TOO_MANY_REQUESTS: "Too many requests. Please retry shortly.",
    SERVICE_DISABLED: "This capability is currently disabled on the platform.",
    NO_USABLE_CHANNEL: "No upstream channel is currently available for this model.",
    CAPABILITY_MISMATCH: "The requested model does not support this endpoint.",
    VALIDATION_ERROR: "The request body is invalid.",
    INTERNAL_ERROR: "The server had an error while processing your request.",
};

export function publicMessageFor(code: string, fallback: string) {
    return CODE_TO_PUBLIC_MESSAGE[code] ?? fallback;
}

export function errorTypeForStatus(status: number, code: string): OpenAiErrorType {
    if (CODE_TO_TYPE[code]) return CODE_TO_TYPE[code];
    if (status === HttpStatus.UNAUTHORIZED) return "invalid_api_key";
    if (status === HttpStatus.FORBIDDEN) return "permission_denied";
    if (status === HttpStatus.PAYMENT_REQUIRED) return "insufficient_quota";
    if (status === HttpStatus.TOO_MANY_REQUESTS) return "rate_limit_exceeded";
    if (status === HttpStatus.BAD_GATEWAY || status === HttpStatus.SERVICE_UNAVAILABLE) return "upstream_error";
    if (status >= 500) return "server_error";
    return "invalid_request_error";
}

export function isOpenAiErrorBody(value: unknown): value is OpenAiErrorBody {
    if (!value || typeof value !== "object") return false;
    const error = (value as { error?: unknown }).error;
    return Boolean(error && typeof error === "object" && "type" in error && "message" in error);
}
