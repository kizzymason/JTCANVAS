import { describe, expect, it } from "vitest";
import {
    SEEDANCE_CREATE_PATHS,
    seedanceCreateBody,
    seedanceResolution,
    seedanceStatusPaths,
    videoResultUrl,
    videoTaskId,
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
    });
});
