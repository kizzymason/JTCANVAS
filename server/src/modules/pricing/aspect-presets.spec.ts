import { describe, expect, it } from "vitest";
import { completePresetSizes, defaultAspectPresets, defaultVideoAspectPresets, parseAspectPresets, piapiAspectPresets, presetSizeForQuality, tierFromPixelSize } from "./aspect-presets";

describe("aspect presets", () => {
    it("uses Seedream native pixels instead of a linear 2× of 1K", () => {
        const presets = defaultAspectPresets();
        const widescreen = presets.find((item) => item.ratio === "16:9")!;
        expect(widescreen.sizes).toEqual({ "1K": "1424x800", "2K": "2816x1584", "4K": "5504x3040" });
        expect(presetSizeForQuality(widescreen, "1K")).toBe("1424x800");
        expect(presetSizeForQuality(widescreen, "2K")).toBe("2816x1584");
        expect(presetSizeForQuality(widescreen, "4K")).toBe("5504x3040");
        expect(presets.find((item) => item.ratio === "9:16")?.sizes).toEqual({ "1K": "800x1424", "2K": "1584x2816", "4K": "3040x5504" });
        expect(presets.find((item) => item.ratio === "4:3")?.sizes["2K"]).toBe("2368x1776");
        expect(presets.find((item) => item.ratio === "4:3")?.sizes["2K"]).not.toBe("2304x1728");
        expect(presets.find((item) => item.ratio === "1:1")?.sizes["1K"]).toBe("1024x1024");
        expect(presets.find((item) => item.ratio === "4:5")?.sizes["1K"]).toBe("896x1120");
        expect(presets.find((item) => item.ratio === "3:1")?.sizes["1K"]).toBe("1680x560");
        expect(presets.map((item) => item.ratio)).toEqual(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9", "9:21", "2:1", "1:2", "3:1", "1:3", "auto"]);
    });

    it("uses official Seedream pixels for PiAPI Pro and Lite", () => {
        for (const kind of ["pro", "lite"] as const) {
            const presets = piapiAspectPresets(kind);
            expect(presets.find((item) => item.ratio === "16:9")?.sizes).toEqual({ "1K": "1424x800", "2K": "2816x1584", "4K": "5504x3040" });
            expect(presets.find((item) => item.ratio === "9:16")?.sizes["1K"]).toBe("800x1424");
            expect(presets.find((item) => item.ratio === "4:3")?.sizes["2K"]).toBe("2368x1776");
            expect(presets.map((item) => item.ratio)).toEqual(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9", "auto"]);
        }
    });

    it("keeps video presets on 1280x720 rather than Seedream image pixels", () => {
        const presets = defaultVideoAspectPresets();
        expect(presets.find((item) => item.ratio === "16:9")?.sizes).toEqual({ "1K": "1280x720", "2K": "2560x1440", "4K": "3840x2160" });
        expect(presets.find((item) => item.ratio === "9:16")?.sizes["1K"]).toBe("720x1280");
        expect(presets.map((item) => item.ratio)).not.toContain("4:5");
    });

    it("expands a stored aspectRatios list onto the default pixels without adding extra ratios", () => {
        const presets = parseAspectPresets(undefined, ["16:9", "nope", "1:1", "auto"]);
        expect(presets.map((item) => item.ratio)).toEqual(["16:9", "1:1", "auto"]);
        expect(presets[0]?.sizes["1K"]).toBe("1424x800");
        expect(presets[0]?.sizes["2K"]).toBe("2816x1584");
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
            sizes: { "1K": "1280x720", "2K": "1920x1080", "4K": "5504x3040" },
        });
    });

    it("fills blank 2K/4K from the native API table instead of doubling 1K", () => {
        expect(completePresetSizes({ "1K": "1424x800" }, "16:9")).toEqual({ "1K": "1424x800", "2K": "2816x1584", "4K": "5504x3040" });
        expect(completePresetSizes({ "1K": "1312x736" }, "16:9")["2K"]).toBe("2816x1584");
        expect(completePresetSizes({ "1K": "1152x864" }, "4:3")["2K"]).toBe("2368x1776");
        expect(completePresetSizes({ "1K": "900x600" })["2K"]).toBe("1800x1200");
    });

    it("maps native pixels onto the matching 1K/2K/4K price tier", () => {
        expect(tierFromPixelSize(1424, 800)).toBe("1K");
        expect(tierFromPixelSize(2816, 1584)).toBe("2K");
        expect(tierFromPixelSize(1584, 2816)).toBe("2K");
        expect(tierFromPixelSize(5504, 3040)).toBe("4K");
        expect(tierFromPixelSize(2560, 1440)).toBe("2K");
    });
});
