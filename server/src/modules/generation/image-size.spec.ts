import { describe, expect, it } from "vitest";
import { normalizeBackground, normalizeQuality, geminiImageSize, pricingSpec, resolveRequestSize } from "./image-size";

describe("image sizing", () => {
    it("normalises quality aliases", () => {
        expect(normalizeQuality("1k")).toBe("low");
        expect(normalizeQuality("2K")).toBe("medium");
        expect(normalizeQuality("high")).toBe("high");
        expect(normalizeQuality("nonsense")).toBeUndefined();
        expect(normalizeQuality(undefined)).toBeUndefined();
    });

    it("only forwards a transparent background", () => {
        expect(normalizeBackground("transparent")).toBe("transparent");
        expect(normalizeBackground("auto")).toBeUndefined();
        expect(normalizeBackground("")).toBeUndefined();
    });

    it("treats auto and empty size as provider default", () => {
        expect(resolveRequestSize("low", "auto")).toBeUndefined();
        expect(resolveRequestSize("low", "")).toBeUndefined();
    });

    it("maps a ratio plus quality onto a valid pixel size", () => {
        expect(resolveRequestSize("low", "1:1")).toBe("1024x1024");
        expect(resolveRequestSize("2K", "16:9")).toBe("2816x1584");
        expect(resolveRequestSize("4K", "9:16")).toBe("3040x5504");
        expect(resolveRequestSize("1K", "3:1")).toBe("1680x560");
    });

    it("passes an explicit pixel size through after validating it", () => {
        expect(resolveRequestSize(undefined, "1024x1024")).toBe("1024x1024");
        expect(() => resolveRequestSize(undefined, "1023x1024")).toThrow();
        expect(resolveRequestSize(undefined, "4096x1024")).toBe("4096x1024");
        expect(() => resolveRequestSize(undefined, "5120x1024")).toThrow();
        expect(() => resolveRequestSize(undefined, "banana")).toThrow();
    });

    it("rejects ratios beyond the provider limit", () => {
        expect(() => resolveRequestSize("low", "5:1")).toThrow();
    });

    it("derives the price tier from quality first so ultrawide 1K is not billed as 2K", () => {
        expect(pricingSpec("low", "1:1")).toBe("1K");
        expect(pricingSpec("1K", "21:9")).toBe("1K");
        expect(pricingSpec("2K", "16:9")).toBe("2K");
        expect(pricingSpec("2K", "2816x1584")).toBe("2K");
        expect(pricingSpec(undefined, "2048x2048")).toBe("2K");
        expect(pricingSpec(undefined, "3840x2160")).toBe("4K");
        expect(pricingSpec("low", "auto")).toBe("1K");
        expect(pricingSpec("high", "auto")).toBe("4K");
        expect(pricingSpec("auto", "auto")).toBeUndefined();
        expect(pricingSpec("auto", "16:9")).toBeUndefined();
    });

    it("maps custom pixels onto API price tiers by native size and area, not a 1280/2560 longest-edge cutoff", () => {
        expect(pricingSpec(undefined, "1424x800")).toBe("1K");
        expect(pricingSpec(undefined, "1312x736")).toBe("1K");
        expect(pricingSpec(undefined, "1568x672")).toBe("1K");
        expect(pricingSpec(undefined, "2816x1584")).toBe("2K");
        expect(pricingSpec(undefined, "1584x2816")).toBe("2K");
        expect(pricingSpec(undefined, "2560x1440")).toBe("2K");
        expect(pricingSpec(undefined, "1440x2560")).toBe("2K");
        expect(pricingSpec(undefined, "5504x3040")).toBe("4K");
        expect(pricingSpec(undefined, "3072x3072")).toBe("4K");
    });

    it("sends Gemini the selected 1K/2K/4K label even when the long edge looks like the next tier", () => {
        expect(geminiImageSize("2K", { width: 2816, height: 1584 })).toBe("2K");
        expect(geminiImageSize("1K", { width: 1424, height: 800 })).toBe("1K");
        expect(geminiImageSize(undefined, { width: 2816, height: 1584 })).toBe("2K");
        expect(geminiImageSize("high", null)).toBe("4K");
    });
});
