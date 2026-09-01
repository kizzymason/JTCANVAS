import { describe, expect, it } from "vitest";
import { defaultAspectPresets, parseAspectPresets, presetSizeForQuality } from "./aspect-presets";

describe("aspect presets", () => {
    it("uses the site 1K table and exact 2× / 4× fills", () => {
        const presets = defaultAspectPresets();
        const widescreen = presets.find((item) => item.ratio === "16:9")!;
        expect(widescreen.sizes).toEqual({ "1K": "1280x720", "2K": "2560x1440", "4K": "5120x2880" });
        expect(presetSizeForQuality(widescreen, "1K")).toBe("1280x720");
        expect(presetSizeForQuality(widescreen, "2K")).toBe("2560x1440");
        expect(presetSizeForQuality(widescreen, "4K")).toBe("5120x2880");
        expect(presets.find((item) => item.ratio === "9:16")?.sizes["1K"]).toBe("720x1280");
        expect(presets.find((item) => item.ratio === "1:1")?.sizes["1K"]).toBe("1024x1024");
        expect(presets.find((item) => item.ratio === "3:1")?.sizes["1K"]).toBe("1680x560");
        expect(presets.map((item) => item.ratio)).toEqual(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "21:9", "3:1", "1:3", "auto"]);
    });

    it("expands a stored aspectRatios list onto the default pixels without adding extra ratios", () => {
        const presets = parseAspectPresets(undefined, ["16:9", "nope", "1:1", "auto"]);
        expect(presets.map((item) => item.ratio)).toEqual(["16:9", "1:1", "auto"]);
        expect(presets[0]?.sizes["1K"]).toBe("1280x720");
        expect(presets[0]?.sizes["2K"]).toBe("2560x1440");
    });

    it("keeps an admin-edited preset list as-is per model", () => {
        const presets = parseAspectPresets(
            [{ ratio: "16:9", label: "横屏", sizes: { "1K": "1280x720", "2K": "1920x1080" } }],
            ["1:1", "9:16"],
        );
        expect(presets).toHaveLength(1);
        expect(presets[0]).toEqual({
            ratio: "16:9",
            label: "横屏",
            sizes: { "1K": "1280x720", "2K": "1920x1080", "4K": "5120x2880" },
        });
    });
});
