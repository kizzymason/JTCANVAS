import { describe, expect, it } from "vitest";
import {
    SEEDANCE_CREATE_PATHS,
    friendlySeedanceError,
    seedanceCreateBody,
    seedanceAspectRatio,
    seedanceVideoRatio,
    seedanceResolution,
    seedanceStatusPaths,
    videoResultUrl,
    videoTaskId,
    videoUsageTokens,
} from "./seedance-video";

describe("Seedance WhatsToken paths", () => {
    it("creates on /v1/video/generations before the Sora /v1/videos paths", () => {
        expect(SEEDANCE_CREATE_PATHS[0]).toBe("/v1/video/generations");
        expect(SEEDANCE_CREATE_PATHS).not.toContain("/v1/videos");
        expect(seedanceStatusPaths("cgt-1")[0]).toBe("/v1/video/generations/cgt-1");
    });

    it("maps UI 2160 onto Ark/WhatsToken 4k instead of 2160p", () => {
        expect(seedanceResolution("720")).toBe("720p");
        expect(seedanceResolution("1080p")).toBe("1080p");
        expect(seedanceResolution("2160")).toBe("4k");
        expect(seedanceResolution("4K")).toBe("4k");
        expect(seedanceResolution("")).toBe("720p");
        expect(seedanceResolution("480")).toBe("480p");
        expect(seedanceResolution("480p")).toBe("480p");
        expect(seedanceResolution("720")).toBe("720p");
    });

    it("sends 480p UI choices as 480p so token volume matches the 480p price row", () => {
        const body = seedanceCreateBody({
            model: "seedance-2-0-pro-NSFW",
            prompt: "walk",
            seconds: 12,
            resolution: "480",
        });
        expect(body.resolution).toBe("480p");
        expect(body.size).toBe("480p");
        expect(body.metadata).toMatchObject({ resolution: "480p" });
    });

    it("maps copyright-audio failures to a Chinese retry hint", () => {
        expect(friendlySeedanceError("The request failed because the output audio may be related to copyright restrictions. Request id: 1")).toBe(
            "生成失败：输出音频可能涉及版权限制。请关闭「生成声音」后重试，或更换提示词。",
        );
    });

    it("maps invalid r2v duration to a Chinese retry hint", () => {
        expect(
            friendlySeedanceError("the parameter duration specified in the request is not valid for model dreamina-seedance-2-0-fast in r2v Request id: 1"),
        ).toBe("该模型最低生成时长4S");
    });

    it("sends prompt, explicit generate_audio, and a text content item", () => {
        const body = seedanceCreateBody({
            model: "seedance-2-0-fast-NSFW",
            prompt: "a cat walks",
            seconds: 4,
            resolution: "720",
            size: "16:9",
            generateAudio: false,
            watermark: false,
            references: [{ mimeType: "image/png", url: "https://cdn.example/a.png" }],
        });
        expect(body).toMatchObject({
            model: "seedance-2-0-fast-NSFW",
            prompt: "a cat walks",
            duration: 4,
            size: "720p",
            resolution: "720p",
            generate_audio: false,
            aspect_ratio: "16:9",
            ratio: "16:9",
        });
        expect(body.content).toEqual([
            { type: "text", text: "a cat walks" },
            { type: "image_url", image_url: { url: "https://cdn.example/a.png" }, role: "reference_image" },
        ]);
        expect(body.metadata).toMatchObject({ resolution: "720p", ratio: "16:9", generate_audio: false });
    });

    it("reads WhatsToken and Ark task envelopes", () => {
        expect(videoTaskId({ id: "cgt-20260901200156-rd66g", object: "video.generation", status: "pending" })).toBe(
            "cgt-20260901200156-rd66g",
        );
        expect(videoTaskId({ task_id: "mvt-1" })).toBe("mvt-1");
        expect(videoResultUrl({ status: "succeeded", content: { video_url: "https://cdn.example/out.mp4" } })).toBe(
            "https://cdn.example/out.mp4",
        );
        expect(videoResultUrl({ url: "https://cdn.example/direct.mp4" })).toBe("https://cdn.example/direct.mp4");
        // MiniMax on this relay answers with a list rather than a single object.
        expect(videoResultUrl({ status: "completed", data: [{ url: "https://cdn.example/list.mp4" }] })).toBe("https://cdn.example/list.mp4");
        expect(videoResultUrl({ status: "completed", data: [] })).toBe("");
        expect(videoUsageTokens({ usage: { completion_tokens: 120946, total_tokens: 120946 } })).toBe(120946);
        expect(videoUsageTokens({ data: { usage: { output_tokens: "100858" } } })).toBe(100858);
        expect(videoUsageTokens({ data: [{ usage: { completion_tokens: 130196 } }] })).toBe(130196);
        expect(videoUsageTokens({ status: "succeeded" })).toBeUndefined();
    });
});


describe("Seedance aspect ratio snapping", () => {
    it("keeps the general helper exact, and snaps only for video", () => {
        expect(seedanceAspectRatio("736x1312")).toBe("23:41");
        expect(seedanceAspectRatio("1024x1536")).toBe("2:3");
        expect(seedanceVideoRatio("736x1312")).toBe("9:16");
        expect(seedanceVideoRatio("1312x736")).toBe("16:9");
        expect(seedanceVideoRatio("800x1424")).toBe("9:16");
        expect(seedanceVideoRatio("2048x2048")).toBe("1:1");
    });

    it("keeps supported video labels, ignores auto, and drops sizes with no close ratio", () => {
        expect(seedanceVideoRatio("16:9")).toBe("16:9");
        expect(seedanceVideoRatio("9:16")).toBe("9:16");
        expect(seedanceVideoRatio("21:9")).toBe("21:9");
        expect(seedanceVideoRatio("auto")).toBeUndefined();
        expect(seedanceVideoRatio("")).toBeUndefined();
        expect(seedanceVideoRatio("100x3000")).toBeUndefined();
    });

    it("never puts an unsupported fraction in a video create body", () => {
        const body = seedanceCreateBody({
            model: "seedance-2-0-pro-NSFW",
            prompt: "walk",
            seconds: 10,
            resolution: "480",
            size: "736x1312",
        });
        expect(body.metadata).toMatchObject({ ratio: "9:16" });
        expect(body.ratio).toBe("9:16");
        expect(body.aspect_ratio).toBe("9:16");
        expect(JSON.stringify(body)).not.toContain("23:41");
    });
});
