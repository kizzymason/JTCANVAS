import { describe, expect, it } from "vitest";
import type { TaskResponse } from "../generation/generation.service";
import type { PublicModel } from "../pricing/pricing.types";
import { parseModelFeatures } from "../pricing/model-features";
import type { OpenAiApiError, OpenAiErrorBody } from "./openai-errors";
import {
    assertReferenceUrls,
    chatUsageFrom,
    dedupeModels,
    mapImageBackground,
    mapImageQuality,
    messagesToPrompt,
    resolutionFromSize,
    toModelObject,
    toVideoObject,
    videoStatusFor,
} from "./openai-mappers";

function model(partial: Partial<PublicModel> = {}): PublicModel {
    return {
        value: "channel-1::seedream-4-0",
        channelId: "channel-1",
        modelName: "seedream-4-0",
        displayName: "Seedream 4.0",
        capability: "image",
        apiFormat: "openai",
        billingMode: "per_image",
        unitPrice: "0.300000",
        minCharge: "0.000000",
        extraReferencePrice: "0.000000",
        specPrices: {},
        tokenPrices: { input: "0.000000", output: "0.000000" },
        features: parseModelFeatures(null),
        ...partial,
    };
}

/** `HttpException.message` is the class name when the body is an object, so read the envelope. */
function errorMessage(run: () => unknown) {
    try {
        run();
    } catch (error) {
        return ((error as OpenAiApiError).getResponse() as OpenAiErrorBody).error.message;
    }
    throw new Error("expected the call to throw");
}

function task(partial: Partial<TaskResponse> = {}): TaskResponse {
    return {
        id: "task-1",
        capability: "video",
        status: "succeeded",
        modelName: "seedance-1-0-pro",
        quantity: 5,
        succeededCount: 5,
        estimatedCost: "1.000000",
        actualCost: "1.000000",
        outputFileIds: [],
        outputText: null,
        error: "",
        params: { seconds: 5, size: "1280x720" },
        createdAt: new Date("2026-01-01T00:00:00Z"),
        finishedAt: new Date("2026-01-01T00:01:00Z"),
        ...partial,
    } as unknown as TaskResponse;
}

describe("model listing", () => {
    it("exposes the bare model name, not the qualified channel form", () => {
        expect(toModelObject(model(), 1700000000)).toEqual({ id: "seedream-4-0", object: "model", created: 1700000000, owned_by: "jtcanvas" });
    });

    it("keeps the first channel when two channels serve the same model name", () => {
        const unique = dedupeModels([model({ value: "a::seedream-4-0", channelId: "a" }), model({ value: "b::seedream-4-0", channelId: "b" })]);
        expect(unique).toHaveLength(1);
        expect(unique[0].channelId).toBe("a");
    });
});

describe("video job mapping", () => {
    it("maps internal statuses onto the OpenAI job state machine", () => {
        expect(videoStatusFor("pending")).toBe("queued");
        expect(videoStatusFor("running")).toBe("in_progress");
        expect(videoStatusFor("succeeded")).toBe("completed");
        // A short clip still delivered a usable file, so downstream must be able to download it.
        expect(videoStatusFor("partial")).toBe("completed");
        expect(videoStatusFor("failed")).toBe("failed");
        expect(videoStatusFor("cancelled")).toBe("failed");
    });

    it("reports a completed job at 100% with no error", () => {
        const video = toVideoObject(task());
        expect(video).toMatchObject({ object: "video", status: "completed", progress: 100, seconds: "5", size: "1280x720", error: null });
        expect(video.completed_at).toBe(Math.floor(Date.parse("2026-01-01T00:01:00Z") / 1000));
    });

    it("never claims 100% while the job is still running", () => {
        const video = toVideoObject(task({ status: "running", succeededCount: 5, quantity: 5, finishedAt: null }));
        expect(video.status).toBe("in_progress");
        expect(video.progress).toBeLessThanOrEqual(95);
        expect(video.completed_at).toBeNull();
    });

    it("surfaces the upstream message on a failed job", () => {
        expect(toVideoObject(task({ status: "failed", error: "content policy" })).error).toEqual({ code: "generation_failed", message: "content policy" });
    });

    it("falls back to the resolution tier when no size was requested", () => {
        expect(toVideoObject(task({ params: { seconds: 5, resolution: "720" } })).size).toBe("720");
    });
});

describe("chat usage", () => {
    it("prefers the settled counts the worker writes back", () => {
        expect(chatUsageFrom(task({ capability: "text", params: { inputTokens: 100, actualInputTokens: 120, actualOutputTokens: 40 } }))).toEqual({
            prompt_tokens: 120,
            completion_tokens: 40,
            total_tokens: 160,
        });
    });

    it("falls back to the pre-call input estimate before settlement", () => {
        expect(chatUsageFrom(task({ capability: "text", params: { inputTokens: 100 } }))).toEqual({ prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 });
    });

    it("treats junk counts as zero rather than emitting NaN", () => {
        expect(chatUsageFrom(task({ capability: "text", params: { actualInputTokens: "abc", actualOutputTokens: -5 } }))).toEqual({
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        });
    });
});

describe("messagesToPrompt", () => {
    it("labels roles so a multi-turn transcript keeps its structure", () => {
        const prompt = messagesToPrompt([
            { role: "system", content: "Be brief." },
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi" },
            { role: "user", content: "Again?" },
        ]);
        expect(prompt).toBe("[system]\nBe brief.\n\n[user]\nHello\n\n[assistant]\nHi\n\n[user]\nAgain?");
    });

    it("flattens the OpenAI content-parts array", () => {
        expect(
            messagesToPrompt([
                {
                    role: "user",
                    content: [
                        { type: "text", text: "describe" },
                        { type: "text", text: "this" },
                    ],
                },
            ]),
        ).toBe("[user]\ndescribe\nthis");
    });

    it("rejects an empty transcript with an invalid_request error", () => {
        expect(() => messagesToPrompt([])).toThrowError(expect.objectContaining({ response: { error: expect.objectContaining({ type: "invalid_request_error", param: "messages" }) } }));
        expect(errorMessage(() => messagesToPrompt([]))).toMatch(/at least one message/);
        expect(errorMessage(() => messagesToPrompt([{ role: "user", content: "   " }]))).toMatch(/any text content/);
    });
});

describe("image parameter mapping", () => {
    it("maps the legacy DALL-E quality names onto platform tiers", () => {
        expect(mapImageQuality("standard")).toBe("medium");
        expect(mapImageQuality("hd")).toBe("high");
        expect(mapImageQuality("high")).toBe("high");
        expect(mapImageQuality("auto")).toBeUndefined();
        expect(mapImageQuality(undefined)).toBeUndefined();
    });

    it("only forwards a transparent background", () => {
        expect(mapImageBackground("transparent")).toBe("transparent");
        expect(mapImageBackground("opaque")).toBeUndefined();
    });
});

describe("resolutionFromSize", () => {
    it("prices a portrait clip the same as landscape by using the short edge", () => {
        expect(resolutionFromSize("1280x720")).toBe("720");
        expect(resolutionFromSize("720x1280")).toBe("720");
    });

    it("snaps to the nearest tier at or above the short edge", () => {
        expect(resolutionFromSize("854x480")).toBe("480");
        expect(resolutionFromSize("1920x1080")).toBe("1080");
        expect(resolutionFromSize("3840x2160")).toBe("1080");
    });

    it("returns undefined for shapes the price table cannot key on", () => {
        expect(resolutionFromSize("auto")).toBeUndefined();
        expect(resolutionFromSize("16:9")).toBeUndefined();
        expect(resolutionFromSize(undefined)).toBeUndefined();
    });
});

describe("assertReferenceUrls", () => {
    it("accepts absolute http(s) URLs", () => {
        expect(assertReferenceUrls(["https://cdn.example.com/a.png"], "image")).toEqual(["https://cdn.example.com/a.png"]);
    });

    it("rejects data URLs and file ids the worker cannot fetch", () => {
        expect(errorMessage(() => assertReferenceUrls(["data:image/png;base64,AAA"], "image"))).toMatch(/absolute http\(s\) URL/);
        expect(errorMessage(() => assertReferenceUrls(["file_abc"], "image"))).toMatch(/absolute http\(s\) URL/);
    });
});
