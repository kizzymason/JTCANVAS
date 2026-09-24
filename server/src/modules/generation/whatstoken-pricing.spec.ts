import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { RepriceChannelDto } from "../admin/dto/admin.dto";
import { tokenFreezeCost, tokenTimeMultiplier, tokenUsageCostString, scaleTokenPrices } from "../pricing/token-pricing";
import { catalogPriceRows } from "./whatstoken-repricing";
import { isWhatsTokenChannel, WHATSTOKEN_ADDED_MODEL_NAMES, whatsTokenImagePixelSpec } from "./whatstoken-catalog";
import { settleGenerationTask } from "./generation-settlement";

const rates = (name: string, factor = "1.3") => Object.fromEntries(catalogPriceRows(name, factor)!.map((row) => [row.spec ?? "default", row.unitPrice]));
describe("cost-plus catalogue", () => {
    it("adds exactly the 13 requested model IDs and uses discounted costs", () => {
        expect(WHATSTOKEN_ADDED_MODEL_NAMES.size).toBe(13);
        expect(rates("gpt-6-astra-special")).toMatchObject({ input: "14.040000", output: "70.200000", "input:9999000": "28.080000", "output:9999000": "105.300000", "cache_write:9999000": "35.100000" });
        expect(rates("gpt-6-astra-azure")).toMatchObject({ input: "73.008000", output: "365.040000", "input:1050000": "146.016000", "cache_read:1050000": "14.601600" });
        expect(rates("claude-opus-5-kiro")).toMatchObject({ input: "4.680000", cache_write: "5.850000" });
        expect(rates("claude-opus-5-ccmax")).toMatchObject({ input: "15.444000", cache_read: "1.544400" });
        expect(rates("claude-fable-5-1-stable")).toMatchObject({ output: "276.120000", cache_read: "1.380600" });
        expect(rates("seed-Character-NSFW")).toMatchObject({ "input:32000": "2.246400", "output:128000": "17.971200" });
        expect(rates("deepseek-v4-1-flash")).toMatchObject({ input: "0.673920", output: "2.695680", cache_read: "0.013478" });
    });
    it("prices image area bands, fixed rates and additional references", () => {
        expect(rates("dola-seedream-5-0-pro")).toMatchObject({ "1K": "0.294840", "2K": "0.589680" });
        expect(rates("seedream-5-0-pro")).toMatchObject({ "1K": "0.353808", "2K": "0.707616" });
        expect(catalogPriceRows("seedream-5-0-pro", "1.3")![0].extraReferencePrice).toBe("0.023587");
        expect(rates("seedream-5-0-spg")["2K"]).toBe("0.229320");
        expect(rates("seedream-5.0-lite")["2K"]).toBe("0.117936");
        expect(whatsTokenImagePixelSpec("seedream-5-0-pro", "1600x1472")).toBe("1K");
        expect(whatsTokenImagePixelSpec("seedream-5-0-pro", "1600x1488")).toBe("2K");
    });
    it("uses separate encoded-token video costs for reference and non-reference", () => {
        expect(rates("seedance-2.0-self-developed-NSFW")).toMatchObject({ "tokens:720": "47.174400", "tokens:720-video": "28.978560", "tokens:2160": "26.956800" });
        expect(rates("seedance-2.5-self-developed-NSFW")).toMatchObject({ "tokens:1080": "78.848640", "tokens:1080-video": "47.174400" });
    });
    it("recalculates from cost without compounding and retains unknown cost models", () => {
        expect(rates("seedream-5.0-lite", "1")["2K"]).toBe("0.090720");
        expect(rates("seedream-5.0-lite", "1.5")["2K"]).toBe("0.136080");
        expect(catalogPriceRows("gemini-3.1-flash-lite-image", "1.5")).toBeUndefined();
        expect(catalogPriceRows("unknown", "1.5")).toBeUndefined();
        expect(isWhatsTokenChannel({ baseUrl: "https://www.whatstoken.ai.evil.test" })).toBe(false);
    });
    it("validates percent input without float conversion", async () => {
        for (const value of ["-1", "NaN", "1e3", 30, "30.1234567"]) expect(await validate(plainToInstance(RepriceChannelDto, { markupPercent: value }))).not.toHaveLength(0);
        for (const value of ["0", "30", "12.123456"]) expect(await validate(plainToInstance(RepriceChannelDto, { markupPercent: value }))).toHaveLength(0);
    });
});
describe("token settlement buckets and snapshots", () => {
    const prices = { input: "10", output: "50", cacheRead: "1", cacheWrite: "12.5", tiers: [
        { maxInputTokens: 272000, input: "10", output: "50", cacheRead: "1", cacheWrite: "12.5" },
        { maxInputTokens: 9999000, input: "20", output: "75", cacheRead: "2", cacheWrite: "25" },
    ] };
    it("charges each input bucket once and selects tiers from total input including cache", () => {
        expect(tokenUsageCostString({ inputTokens: 272000, outputTokens: 1000, cacheReadTokens: 270000, cacheWriteTokens: 1000 }, prices)).toBe("0.342500");
        expect(tokenUsageCostString({ inputTokens: 272001, outputTokens: 1000, cacheReadTokens: 270000, cacheWriteTokens: 1000 }, prices)).toBe("0.660020");
        expect(tokenFreezeCost(272000, 1000, prices).toString()).toBe("3.45");
        expect(scaleTokenPrices(prices, "0.9").tiers?.[1].cacheWrite).toBe("22.500000");
    });
    it.each([["00:59:59", "1"], ["01:00:00", "2"], ["03:59:59", "2"], ["04:00:00", "1"], ["06:00:00", "2"], ["10:00:00", "1"], ["15:59:59", "1"], ["16:00:00", "1"]])("UTC+8 peak boundary %s", (utc, expected) => {
        expect(tokenTimeMultiplier({ input: "1", output: "1", peakHours: true }, new Date(`2026-09-22T${utc}Z`))).toBe(expected);
    });
    it("preserves submitted rates, applies time/discount once and caps settlement", () => {
        const base = { capability: "text", quantity: 100, outputCount: 1, estimatedCost: "10", billingMode: "per_token", tokenPrices: { input: "10", output: "50" }, billingMultiplier: "0.9", tokenTimeMultiplier: "2", usage: { inputTokens: 100000, outputTokens: 10000 } };
        expect(settleGenerationTask(base).actualCost).toBe("2.700000");
        expect(settleGenerationTask({ ...base, estimatedCost: "1" }).actualCost).toBe("1.000000");
        expect(settleGenerationTask({ ...base, outputCount: 0 }).actualCost).toBe("0.000000");
        expect(settleGenerationTask({ capability: "video", quantity: 5, outputCount: 1, estimatedCost: "100", usageTokens: 100000, videoTokenPrice: "47.1744", billingMultiplier: "0.9" }).actualCost).toBe("4.245696");
    });
});
