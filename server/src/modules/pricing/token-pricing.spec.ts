import { describe, expect, it } from "vitest";
import { hasTokenPrices, normalizeTokenCount, tokenBucketCost, tokenUsageCostString } from "./token-pricing";

describe("token pricing", () => {
    it("prices a bucket per 1M tokens", () => {
        expect(tokenBucketCost(1_000_000, "7.2").toFixed(6)).toBe("7.200000");
        expect(tokenBucketCost(1_000, "7.2").toFixed(6)).toBe("0.007200");
        expect(tokenBucketCost(0, "7.2").toFixed(6)).toBe("0.000000");
    });

    it("adds input and output buckets", () => {
        expect(tokenUsageCostString({ inputTokens: 1000, outputTokens: 500 }, { input: "7.2", output: "28.8" })).toBe("0.021600");
    });

    it("rounds up so a fractional remainder is never given away", () => {
        expect(tokenUsageCostString({ inputTokens: 1, outputTokens: 0 }, { input: "7.2", output: "0" })).toBe("0.000008");
    });

    it("rejects nonsense token counts instead of propagating NaN into money", () => {
        expect(normalizeTokenCount("abc")).toBe(0);
        expect(normalizeTokenCount(-5)).toBe(0);
        expect(normalizeTokenCount(12.7)).toBe(12);
        expect(normalizeTokenCount(undefined)).toBe(0);
    });

    it("detects whether a model actually has token prices configured", () => {
        expect(hasTokenPrices({ input: "0", output: "0" })).toBe(false);
        expect(hasTokenPrices({ input: "0", output: "28.8" })).toBe(true);
        expect(hasTokenPrices(undefined)).toBe(false);
    });
});
