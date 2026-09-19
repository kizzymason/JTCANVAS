import { describe, expect, it } from "vitest";
import { settleGenerationTask, videoSecondsFromParams } from "./generation-settlement";

describe("settleGenerationTask", () => {
    it("bills a successful Seedance clip for the full requested seconds, not 1 file", () => {
        const settled = settleGenerationTask({
            capability: "video",
            quantity: 12,
            estimatedCost: "3.837684",
            outputCount: 1,
            actualQuantity: 12,
        });
        expect(settled).toEqual({
            status: "succeeded",
            succeededCount: 12,
            actualCost: "3.837684",
        });
    });

    it("does not treat a missing actualQuantity as one second when a video file exists", () => {
        const settled = settleGenerationTask({
            capability: "video",
            quantity: 10,
            estimatedCost: "3.198070",
            outputCount: 1,
        });
        expect(settled.status).toBe("succeeded");
        expect(settled.succeededCount).toBe(10);
        expect(settled.actualCost).toBe("3.198070");
    });

    it("pro-rates a multi-clip video when only some seconds were delivered", () => {
        const settled = settleGenerationTask({
            capability: "video",
            quantity: 24,
            estimatedCost: "7.675368",
            outputCount: 1,
            actualQuantity: 12,
        });
        expect(settled.status).toBe("partial");
        expect(settled.succeededCount).toBe(12);
        expect(settled.actualCost).toBe("3.837684");
    });

    it("releases a failed video with zero charge", () => {
        expect(
            settleGenerationTask({
                capability: "video",
                quantity: 12,
                estimatedCost: "3.837684",
                outputCount: 0,
            }),
        ).toEqual({ status: "failed", succeededCount: 0, actualCost: "0.000000" });
    });

    it("still pro-rates images by file count", () => {
        const settled = settleGenerationTask({
            capability: "image",
            quantity: 4,
            estimatedCost: "2.000000",
            outputCount: 1,
        });
        expect(settled.status).toBe("partial");
        expect(settled.succeededCount).toBe(1);
        expect(settled.actualCost).toBe("0.500000");
    });
});

describe("videoSecondsFromParams", () => {
    it("uses params.seconds times the number of clips", () => {
        expect(videoSecondsFromParams({ seconds: 12, count: 1 }, 12, 1)).toBe(12);
        expect(videoSecondsFromParams({ seconds: 12, count: 2 }, 24, 1)).toBe(12);
    });
});

describe("Seedance token settlement", () => {
    it("charges the token sell for a successful 12s Pro 480p clip and keeps 30% markup", () => {
        const settled = settleGenerationTask({
            capability: "video",
            quantity: 12,
            estimatedCost: "9.509259",
            outputCount: 1,
            actualQuantity: 12,
            usageTokens: 120946,
            estimatedTokens: 120946,
            upstreamUsdPerM: "8.4",
        });
        expect(settled).toEqual({
            status: "succeeded",
            succeededCount: 12,
            actualCost: "9.509259",
        });
    });

    it("refunds the freeze remainder when upstream used fewer tokens", () => {
        const settled = settleGenerationTask({
            capability: "video",
            quantity: 12,
            estimatedCost: "9.509259",
            outputCount: 1,
            actualQuantity: 12,
            usageTokens: 100000,
            upstreamUsdPerM: "8.4",
        });
        expect(settled.status).toBe("succeeded");
        expect(settled.actualCost).toBe("7.862400");
    });

    it("does not charge above the freeze when upstream tokens exceed the estimate", () => {
        const settled = settleGenerationTask({
            capability: "video",
            quantity: 12,
            estimatedCost: "9.509259",
            outputCount: 1,
            actualQuantity: 12,
            usageTokens: 200000,
            upstreamUsdPerM: "8.4",
        });
        expect(settled.actualCost).toBe("9.509259");
    });

    /**
     * The catalogue figure is quoted at list price. Without re-applying the coefficient a marked-up
     * reseller would settle back down to list price, and a discounted one would be over-charged.
     */
    it("re-applies a reseller markup to the catalogue token figure", () => {
        const settled = settleGenerationTask({
            capability: "video",
            quantity: 12,
            estimatedCost: "11.411111",
            outputCount: 1,
            actualQuantity: 12,
            usageTokens: 100000,
            upstreamUsdPerM: "8.4",
            billingMultiplier: "1.200000",
        });
        // 7.8624 list × 1.2
        expect(settled.actualCost).toBe("9.434880");
    });

    it("re-applies a reseller discount to the catalogue token figure", () => {
        const settled = settleGenerationTask({
            capability: "video",
            quantity: 12,
            estimatedCost: "7.607407",
            outputCount: 1,
            actualQuantity: 12,
            usageTokens: 100000,
            upstreamUsdPerM: "8.4",
            billingMultiplier: "0.800000",
        });
        // 7.8624 list × 0.8, which also has to stay under the discounted freeze.
        expect(settled.actualCost).toBe("6.289920");
    });

    it("does not double-apply the coefficient when scaling the freeze itself", () => {
        const settled = settleGenerationTask({
            capability: "video",
            quantity: 12,
            estimatedCost: "11.411111",
            outputCount: 1,
            actualQuantity: 12,
            usageTokens: 60473,
            estimatedTokens: 120946,
            billingMultiplier: "1.200000",
        });
        expect(settled.actualCost).toBe("5.705556");
    });
});

describe("per-token settlement", () => {
    const tokenPrices = { input: "7.200000", output: "28.800000" };

    it("settles on real usage and refunds the unused output ceiling", () => {
        const settled = settleGenerationTask({
            capability: "text",
            billingMode: "per_token",
            quantity: 5000,
            // Frozen on 1000 input + 4000 output.
            estimatedCost: "0.122400",
            outputCount: 1,
            tokenPrices,
            usage: { inputTokens: 1000, outputTokens: 500 },
        });
        // 1000/1M × 7.2 + 500/1M × 28.8
        expect(settled).toEqual({ status: "succeeded", succeededCount: 1, actualCost: "0.021600" });
    });

    it("applies the reseller coefficient to token usage", () => {
        const settled = settleGenerationTask({
            capability: "text",
            billingMode: "per_token",
            quantity: 5000,
            estimatedCost: "0.146880",
            outputCount: 1,
            tokenPrices,
            usage: { inputTokens: 1000, outputTokens: 500 },
            billingMultiplier: "1.200000",
        });
        expect(settled.actualCost).toBe("0.025920");
    });

    it("bills the upstream's own input count once the freeze carries prompt head-room", () => {
        // Our tokenizer sees ~7 tokens, the relay bills 118 for its framing. Freezing 7 + 512 of
        // head-room plus a 4096 output ceiling leaves the real usage comfortably inside the freeze,
        // so the charge follows the upstream instead of being clipped to a too-small estimate.
        const settled = settleGenerationTask({
            capability: "text",
            billingMode: "per_token",
            quantity: 4615,
            estimatedCost: "0.121724",
            outputCount: 1,
            tokenPrices,
            usage: { inputTokens: 118, outputTokens: 20 },
        });
        // 118/1M × 7.2 + 20/1M × 28.8
        expect(settled.actualCost).toBe("0.001426");
    });

    it("never settles above the freeze even if usage exceeds the ceiling", () => {
        const settled = settleGenerationTask({
            capability: "text",
            billingMode: "per_token",
            quantity: 5000,
            estimatedCost: "0.122400",
            outputCount: 1,
            tokenPrices,
            usage: { inputTokens: 1000, outputTokens: 40_000 },
        });
        expect(settled.actualCost).toBe("0.122400");
    });

    it("falls back to the freeze when the upstream reported no usage at all", () => {
        const settled = settleGenerationTask({
            capability: "text",
            billingMode: "per_token",
            quantity: 5000,
            estimatedCost: "0.122400",
            outputCount: 1,
            tokenPrices,
        });
        expect(settled.actualCost).toBe("0.122400");
    });

    it("charges nothing when a token call produced no text", () => {
        const settled = settleGenerationTask({
            capability: "text",
            billingMode: "per_token",
            quantity: 5000,
            estimatedCost: "0.122400",
            outputCount: 0,
            tokenPrices,
            usage: { inputTokens: 1000, outputTokens: 0 },
        });
        expect(settled).toEqual({ status: "failed", succeededCount: 0, actualCost: "0.000000" });
    });
});
