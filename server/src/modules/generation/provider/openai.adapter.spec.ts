import { Readable } from "node:stream";
import { extractTextUsage } from "./openai.adapter";
import { afterEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { OpenAiAdapter } from "./openai.adapter";
import type { GenerationRequest } from "./provider.types";
import { seedanceCreateBody } from "./seedance-video";
import { providerError, providerFailureDetails } from "./provider-error";

const credentials = { baseUrl: "https://upstream.example/v1", apiKey: "sk-test-secret" };
const request: GenerationRequest = { capability: "video", model: "seedance-2-0-fast-NSFW", prompt: "cat", count: 1, seconds: 4, references: [] };
afterEach(() => vi.restoreAllMocks());

describe("OpenAI relay adapter", () => {
    it("sends all mixed references and roles using the documented WhatsToken fields", async () => {
        const adapter = new OpenAiAdapter();
        const post = vi.fn().mockResolvedValue({ data: { id: "task" } });
        vi.spyOn(axios, "create").mockReturnValue({ post } as never);
        vi.spyOn(adapter as any, "pollSeedanceVideo").mockResolvedValue({ binaries: [], actualQuantity: 4 });
        const refs = Array.from({ length: 9 }, (_, i) => ({ storageKey: String(i), mimeType: "image/png", fileName: "a.png", body: Buffer.alloc(0), publicUrl: `https://cdn.example/${i}` }));
        refs.push({ storageKey: "v", mimeType: "video/mp4", fileName: "v.mp4", body: Buffer.alloc(0), publicUrl: "https://cdn.example/video" });
        refs.push({ storageKey: "a", mimeType: "audio/mpeg", fileName: "a.mp3", body: Buffer.alloc(0), publicUrl: "https://cdn.example/audio" });
        await adapter.generate(credentials, { ...request, references: refs });
        const [path, body] = post.mock.calls[0]!;
        expect(path).toBe("/v1/video/generations");
        expect(body.images).toHaveLength(9);
        expect(body.videos).toEqual(["https://cdn.example/video"]);
        expect(body.audios).toEqual(["https://cdn.example/audio"]);
        expect(body.content).toBeUndefined();
    });
    it("keeps frame roles in native and gateway bodies", () => {
        const body = seedanceCreateBody({ model: request.model, prompt: "cat", references: [{ mimeType: "image/png", url: "https://cdn.example/a", role: "first_frame" }] });
        expect(body.images).toEqual([{ url: "https://cdn.example/a", role: "first_frame" }]);
        expect((body.content as unknown[])[1]).toMatchObject({ role: "first_frame" });
        expect(body.generate_audio).toBe(true);
    });
    it("does not resubmit a paid video after a poll fails", async () => {
        const adapter = new OpenAiAdapter();
        const post = vi.fn().mockResolvedValue({ data: { id: "accepted" } });
        vi.spyOn(axios, "create").mockReturnValue({ post } as never);
        vi.spyOn(adapter as any, "pollSeedanceVideo").mockRejectedValue({ isAxiosError: true, response: { status: 404, data: {} } });
        await expect(adapter.generate(credentials, request)).rejects.toThrow();
        expect(post).toHaveBeenCalledTimes(1);
    });
    it("generates n clips and aggregates seconds and tokens for settlement", async () => {
        const adapter = new OpenAiAdapter();
        vi.spyOn(axios, "create").mockReturnValue({} as never);
        const video = vi.spyOn(adapter as any, "video").mockResolvedValue({ binaries: [{ body: Buffer.from("video"), mimeType: "video/mp4" }], actualQuantity: 4, usageTokens: 100 });
        const result = await adapter.generate(credentials, { ...request, count: 3 });
        expect(video).toHaveBeenCalledTimes(3);
        expect(result).toMatchObject({ actualQuantity: 12, usageTokens: 300 });
        expect(result.binaries).toHaveLength(3);
        video.mockReset().mockResolvedValueOnce({ binaries: [{ body: Buffer.from("video"), mimeType: "video/mp4" }], actualQuantity: 4 }).mockRejectedValue(new Error("failed"));
        expect(await adapter.generate(credentials, { ...request, count: 3 })).toMatchObject({ actualQuantity: 4, usageTokens: undefined });
    });
    it("preserves pixel dimensions and public reference URLs for Seedream", async () => {
        const adapter = new OpenAiAdapter();
        const post = vi.fn().mockResolvedValue({ data: { data: [{ b64_json: Buffer.from("image").toString("base64") }] } });
        vi.spyOn(axios, "create").mockReturnValue({ post } as never);
        await adapter.generate(credentials, { ...request, capability: "image", model: "seedream-5.0-lite-NSFW", size: "2048x2048", quality: "2K", references: [{ storageKey: "a", mimeType: "image/png", fileName: "a.png", body: Buffer.alloc(0), publicUrl: "https://cdn.example/a" }] });
        expect(post.mock.calls[0]![1]).toMatchObject({ size: "2048x2048", image: ["https://cdn.example/a"] });
    });
    it("preserves actionable 400 details without exposing credentials or URLs", () => {
        const error = providerError({ isAxiosError: true, config: { headers: { Authorization: "Bearer private-token-value" } }, response: { status: 400, data: { error: { code: "InvalidSize", param: "size", message: "size invalid private-token-value sk-another-secret https://host/path?token=hidden" } } } });
        expect(providerFailureDetails(error)).toEqual({ upstreamStatus: 400, upstreamCode: "InvalidSize", param: "size" });
        const body = (error as any).getResponse();
        expect(body.message).toContain("size invalid");
        expect(body.message).not.toMatch(/private-token-value|sk-another-secret|token=hidden/);
        expect((error as any).getStatus()).toBe(400);
        const gateway = providerError({ isAxiosError: true, response: { status: 502, data: "<html>secret error dump</html>" } });
        expect((gateway as any).getResponse().message).not.toContain("html");
    });
});

describe("new text model protocols", () => {
    it.each(["claude-opus-5-kiro", "claude-opus-5-ccmax", "claude-fable-5-1-stable", "seed-Character-NSFW", "deepseek-v4-1-flash"])("streams %s through chat including split UTF8 and terminal usage", async (model) => {
        const data = Buffer.from('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"usage":{"prompt_tokens":100,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":80}}}');
        const split = data.indexOf(Buffer.from("你")) + 1;
        const post = vi.fn().mockResolvedValue({ data: Readable.from([data.subarray(0, split), data.subarray(split)]) });
        vi.spyOn(axios, "create").mockReturnValue({ post } as never);
        const result = await new OpenAiAdapter().generate({ ...credentials, baseUrl: "https://www.whatstoken.ai/v1" }, { ...request, capability: "text", model, maxOutputTokens: 256 });
        expect(post.mock.calls[0][0]).toBe("/v1/chat/completions");
        expect(post.mock.calls[0][1]).toMatchObject({ messages: [{ role: "user", content: "cat" }], max_tokens: 256, stream_options: { include_usage: true } });
        expect(result).toMatchObject({ text: "你好", usage: { inputTokens: 100, outputTokens: 2, cacheReadTokens: 80 } });
    });
    it("keeps Azure on Responses and refunds failed terminal responses", async () => {
        const post = vi.fn().mockResolvedValue({ data: Readable.from(['data: {"type":"response.output_text.delta","delta":"hi"}\n\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":2,"input_tokens_details":{"cached_tokens":90}}}}\n\n']) });
        vi.spyOn(axios, "create").mockReturnValue({ post } as never);
        const adapter = new OpenAiAdapter();
        const req = { ...request, capability: "text" as const, model: "gpt-6-astra-azure", maxOutputTokens: 64 };
        expect(await adapter.generate({ ...credentials, baseUrl: "https://www.whatstoken.ai" }, req)).toMatchObject({ text: "hi", usage: { cacheReadTokens: 90 } });
        expect(post.mock.calls[0][0]).toBe("/v1/responses");
        expect(post.mock.calls[0][1]).toMatchObject({ max_output_tokens: 64 });
        expect(post.mock.calls[0][1]).not.toHaveProperty("messages");
        post.mockResolvedValue({ data: Readable.from(['data: {"type":"response.failed"}\n']) });
        await expect(adapter.generate(credentials, req)).rejects.toThrow();
    });
    it("normalizes native cache-only usage without charging cache twice", () => {
        expect(extractTextUsage(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 40, cache_read_input_tokens: 50 } }))).toEqual({ inputTokens: 100, outputTokens: 5, cacheReadTokens: 50, cacheWriteTokens: 40 });
    });
});
