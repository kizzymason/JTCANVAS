import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_SETTINGS } from "./settings.service";
import { assertGenerationEnabled } from "./site-services";

describe("assertGenerationEnabled", () => {
    it("allows image and video when the matching service is on", () => {
        expect(() => assertGenerationEnabled(DEFAULT_SITE_SETTINGS, "image")).not.toThrow();
        expect(() => assertGenerationEnabled(DEFAULT_SITE_SETTINGS, "video")).not.toThrow();
        expect(() => assertGenerationEnabled(DEFAULT_SITE_SETTINGS, "text")).not.toThrow();
    });

    it("rejects image generation when the image service is off", () => {
        expect(() => assertGenerationEnabled({ ...DEFAULT_SITE_SETTINGS, imageGenerationEnabled: false }, "image")).toThrow(/图片生成服务已关闭/);
        expect(() => assertGenerationEnabled({ ...DEFAULT_SITE_SETTINGS, imageGenerationEnabled: false }, "video")).not.toThrow();
    });

    it("rejects video generation when the video service is off", () => {
        expect(() => assertGenerationEnabled({ ...DEFAULT_SITE_SETTINGS, videoGenerationEnabled: false }, "video")).toThrow(/视频生成服务已关闭/);
        expect(() => assertGenerationEnabled({ ...DEFAULT_SITE_SETTINGS, videoGenerationEnabled: false }, "image")).not.toThrow();
    });
});
