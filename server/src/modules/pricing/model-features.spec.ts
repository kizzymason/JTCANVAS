import { describe, expect, it } from "vitest";
import { assertImageGenerationFeatures, assertVideoGenerationFeatures, normalizeImageResolution, parseModelFeatures } from "./model-features";

describe("model features", () => {
    it("fills defaults when the admin left the blob empty", () => {
        const features = parseModelFeatures({});
        expect(features.resolutions).toEqual(["1K", "2K", "4K"]);
        expect(features.maxCount).toBe(15);
        expect(features.supportsTransparent).toBe(false);
        expect(features.aspectRatios).toContain("auto");
        expect(features.aspectRatios).toHaveLength(13);
        expect(features.aspectPresets.find((item) => item.ratio === "16:9")?.sizes["1K"]).toBe("1280x720");
    });

    it("keeps only known image resolutions and ratios", () => {
        const features = parseModelFeatures({
            resolutions: ["1K", "8K", "2K"],
            maxCount: 40,
            supportsTransparent: true,
            aspectRatios: ["16:9", "nope", "1:1"],
        });
        expect(features.resolutions).toEqual(["1K", "2K"]);
        expect(features.maxCount).toBe(15);
        expect(features.supportsTransparent).toBe(true);
        expect(features.aspectRatios).toEqual(["16:9", "1:1"]);
        expect(features.aspectPresets.map((item) => item.ratio)).toEqual(["16:9", "1:1"]);
        expect(features.aspectPresets[0]?.sizes["2K"]).toBe("2560x1440");
    });

    it("maps quality aliases onto resolution tiers", () => {
        expect(normalizeImageResolution("high")).toBe("4K");
        expect(normalizeImageResolution("2k")).toBe("2K");
        expect(normalizeImageResolution("auto")).toBe("auto");
    });

    it("rejects a batch larger than the model allows", () => {
        const features = parseModelFeatures({ maxCount: 1, resolutions: ["1K"] });
        expect(() => assertImageGenerationFeatures(features, { count: 2, quality: "1K" })).toThrow(/最多生成 1 张/);
        expect(() => assertImageGenerationFeatures(features, { count: 1, quality: "1K", background: "transparent" })).toThrow(/透明背景/);
        expect(() => assertImageGenerationFeatures(features, { count: 1, quality: "4K" })).toThrow(/分辨率/);
    });

    it("rejects video seconds and resolutions the model does not allow", () => {
        const features = parseModelFeatures({ videoResolutions: ["720"], maxSeconds: 8 });
        expect(() => assertVideoGenerationFeatures(features, { seconds: 12, resolution: "720" })).toThrow(/最长 8 秒/);
        expect(() => assertVideoGenerationFeatures(features, { seconds: 6, resolution: "480p" })).toThrow(/清晰度/);
        expect(() => assertVideoGenerationFeatures(features, { seconds: 6, resolution: "720" })).not.toThrow();
    });

    it("keeps aspect presets isolated to the parsed model payload", () => {
        const modelA = parseModelFeatures({ aspectPresets: [{ ratio: "16:9", sizes: { "1K": "1280x720" } }] });
        const modelB = parseModelFeatures({ aspectRatios: ["1:1", "9:16"] });
        expect(modelA.aspectRatios).toEqual(["16:9"]);
        expect(modelB.aspectRatios).toEqual(["1:1", "9:16"]);
        expect(modelA.aspectPresets[0]?.sizes["2K"]).toBe("2560x1440");
        expect(modelB.aspectPresets.find((item) => item.ratio === "16:9")).toBeUndefined();
    });
});
