import { HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
    errorTypeForStatus,
    insufficientQuota,
    invalidApiKey,
    invalidRequest,
    isOpenAiErrorBody,
    modelNotFound,
    permissionDenied,
    rateLimited,
    serverError,
    upstreamError,
    type OpenAiErrorBody,
} from "./openai-errors";

/** These strings are a public contract: downstream clients branch on `type` and `code`. */
describe("error envelope", () => {
    it("wraps every error in the shape the OpenAI SDKs parse", () => {
        const error = invalidRequest("`prompt` is required.", "missing_prompt", "prompt");
        expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(error.getResponse()).toEqual({
            error: { message: "`prompt` is required.", type: "invalid_request_error", code: "missing_prompt", param: "prompt" },
        });
    });

    it("always emits param as null rather than omitting it", () => {
        expect((permissionDenied("nope").getResponse() as OpenAiErrorBody).error.param).toBeNull();
    });

    it("uses the status each type is expected to carry", () => {
        expect(invalidApiKey().getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        expect(permissionDenied("no").getStatus()).toBe(HttpStatus.FORBIDDEN);
        expect(insufficientQuota().getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
        expect(modelNotFound("gpt-9").getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect(rateLimited("slow down").getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(upstreamError("boom").getStatus()).toBe(HttpStatus.BAD_GATEWAY);
        expect(serverError().getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it("names the offending model and points param at `model`", () => {
        expect(modelNotFound("gpt-9").getResponse()).toEqual({
            error: { message: "The model `gpt-9` does not exist or you do not have access to it.", type: "model_not_found", code: "model_not_found", param: "model" },
        });
    });
});

describe("errorTypeForStatus", () => {
    it("maps the platform's own codes onto the OpenAI vocabulary", () => {
        expect(errorTypeForStatus(400, "INSUFFICIENT_BALANCE")).toBe("insufficient_quota");
        expect(errorTypeForStatus(400, "TOO_MANY_ACTIVE_TASKS")).toBe("rate_limit_exceeded");
        expect(errorTypeForStatus(400, "NO_USABLE_CHANNEL")).toBe("upstream_error");
        expect(errorTypeForStatus(403, "SERVICE_DISABLED")).toBe("permission_denied");
    });

    it("falls back to the status when the code is unknown", () => {
        expect(errorTypeForStatus(401, "WHATEVER")).toBe("invalid_api_key");
        expect(errorTypeForStatus(402, "WHATEVER")).toBe("insufficient_quota");
        expect(errorTypeForStatus(429, "WHATEVER")).toBe("rate_limit_exceeded");
        expect(errorTypeForStatus(502, "WHATEVER")).toBe("upstream_error");
        expect(errorTypeForStatus(500, "WHATEVER")).toBe("server_error");
        expect(errorTypeForStatus(422, "WHATEVER")).toBe("invalid_request_error");
    });
});

describe("isOpenAiErrorBody", () => {
    it("recognises an already-formatted envelope so the filter does not double-wrap", () => {
        expect(isOpenAiErrorBody({ error: { message: "x", type: "server_error", code: null, param: null } })).toBe(true);
    });

    it("rejects the platform's internal error shape", () => {
        expect(isOpenAiErrorBody({ statusCode: 400, code: "BAD", message: "x" })).toBe(false);
        expect(isOpenAiErrorBody(null)).toBe(false);
        expect(isOpenAiErrorBody("boom")).toBe(false);
    });
});
