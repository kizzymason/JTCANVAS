import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { imageGenerationInput, videoGenerationInput } from "./generation-input";
import { ImageGenerationDto, VideoCreateDto } from "./dto/openai.dto";
import { mediaReferences } from "./media-input";
import { parseModelFeatures } from "../pricing/model-features";
import { pricingSpec } from "../generation/image-size";
import { videoPricingSpec } from "../generation/video-pricing-spec";
import { mediaMime } from "../generation/reference-media";
import type { PublicModel } from "../pricing/pricing.types";

const model = { modelName: "seedream-5.0-lite-NSFW", features: parseModelFeatures({ resolutions: ["2K", "4K"] }) } as PublicModel;
const base = { model: "seedance-2-0-fast-NSFW", prompt: "a cat walks" };
const check = (cls: typeof VideoCreateDto | typeof ImageGenerationDto, value: object) => validate(plainToInstance(cls, value), { whitelist: true, forbidNonWhitelisted: true });

describe("downstream generation contracts", () => {
    it("rejects pixel/quality billing conflicts and maps MiniMax 2K resolution", () => {
        expect(() => imageGenerationInput({ model: model.modelName, prompt: "cat", size: "4096x4096", quality: "low" }, model)).toThrow();
        expect(() => imageGenerationInput({ model: model.modelName, prompt: "cat", size: "1024x1024", quality: "2K" }, model)).toThrow();
        expect(videoGenerationInput({ ...base, resolution: "2K" }).resolution).toBe("1440");
        expect(videoGenerationInput({ ...base, size: "768P" }).resolution).toBe("768");
    });
    it("upscales legacy Lite 1024 square requests and bills the actual tier", () => {
        const input = imageGenerationInput({ model: model.modelName, prompt: "cat", size: "1024x1024" }, model);
        expect(input).toMatchObject({ size: "2048x2048", quality: "2K" });
        expect(pricingSpec(input.quality, input.size)).toBe("2K");
    });
    it("preserves the aspect ratio when raising the minimum tier", () => {
        const input = imageGenerationInput({ model: model.modelName, prompt: "cat", size: "1024x1536" }, model);
        const [w, h] = input.size!.split("x").map(Number);
        expect(w! / h!).toBeCloseTo(2 / 3, 1);
        expect(input.quality).toBe("2K");
    });
    it("accepts image string, image_urls, size aliases and watermark", async () => {
        for (const ref of [{ image: "https://cdn.example/image" }, { image_urls: ["https://cdn.example/1.png", "https://cdn.example/2.png"] }]) {
            const body = { model: model.modelName, prompt: "cat", size: "2k", watermark: false, ...ref };
            expect(await check(ImageGenerationDto, body)).toEqual([]);
            expect(imageGenerationInput(body, model).quality).toBe("2K");
        }
        expect(imageGenerationInput({ model: model.modelName, prompt: "cat", resolution: "4K" }, model).quality).toBe("4K");
    });
    it("accepts image objects, multiple input references, videos and audio with no file extension", async () => {
        const body = { ...base, seconds: "4", input_reference: [{ image_url: "https://cdn.example/1" }, { image_url: { url: "https://cdn.example/2" } }], reference_videos: ["https://cdn.example/movie"], reference_audios: ["https://cdn.example/music"] };
        expect(await check(VideoCreateDto, body)).toEqual([]);
        const mapped = videoGenerationInput(plainToInstance(VideoCreateDto, body));
        expect(mapped.referenceMedia.map((item) => item.type)).toEqual(["image", "image", "video", "audio"]);
        expect(videoPricingSpec(mapped.resolution, mapped.referenceMedia.some((item) => mediaMime[item.type].startsWith("video/")))).toBe("720-video");
    });
    it("preserves default duration and resolves New API metadata before billing", () => {
        expect(videoGenerationInput(base).seconds).toBe(5);
        const mapped = videoGenerationInput({ ...base, metadata: { duration: 12, resolution: "480p", ratio: "9:16", generate_audio: false } });
        expect(mapped).toMatchObject({ seconds: 12, resolution: "480", size: "9:16", generateAudio: false });
        expect(() => videoGenerationInput({ ...base, seconds: 5, metadata: { duration: 12 } })).toThrow();
        expect(() => videoGenerationInput({ ...base, resolution: "480p", metadata: { resolution: "1080p" } })).toThrow();
    });
    it("distinguishes frames from reference mode and rejects mixed roles", () => {
        expect(videoGenerationInput({ ...base, images: ["https://cdn.example/a", "https://cdn.example/b"] }).referenceMedia.map((ref) => ref.role)).toEqual(["first_frame", "last_frame"]);
        expect(videoGenerationInput({ ...base, images: ["https://cdn.example/a"], videos: ["https://cdn.example/v"] }).referenceMedia[0]?.role).toBeUndefined();
        expect(() => videoGenerationInput({ ...base, images: [{ url: "https://cdn.example/a", role: "last_frame" }] })).toThrow();
        expect(() => videoGenerationInput({ ...base, images: [{ url: "https://cdn.example/a", role: "first_frame" }], audios: ["https://cdn.example/v"] })).toThrow();
    });
    it("supports Ark content parts while rejecting unknown fields or ambiguous references", async () => {
        const body = { model: base.model, duration: 5, content: [{ type: "text", text: "a cat" }, { type: "audio_url", audio_url: { url: "https://cdn.example/a" }, role: "reference_audio" }] };
        expect(await check(VideoCreateDto, body)).toEqual([]);
        expect(videoGenerationInput(body).referenceMedia).toMatchObject([{ type: "audio", role: "reference_audio" }]);
        expect((await check(VideoCreateDto, { ...base, metadata: { unknown: true } })).length).toBeGreaterThan(0);
        expect((await check(VideoCreateDto, { ...base, input_reference: { image_url: "https://cdn.example/a", unknown: true } })).length).toBeGreaterThan(0);
        expect(() => mediaReferences({ image_url: "https://cdn.example/a", video_url: "https://cdn.example/v" })).toThrow();
        expect(() => mediaReferences("http://127.0.0.1/a")).toThrow();
        expect(() => mediaReferences("not-a-url")).toThrow();
        expect((await check(VideoCreateDto, { ...base, generate_audio: "false" })).length).toBeGreaterThan(0);
    });
});
