import { describe, expect, it } from "vitest";
import { videoPricingSpec } from "./video-pricing-spec";
import {
    seedanceCatalogSellCny,
    seedanceSellCnyFromTokens,
    seedanceTokensFor,
    usdToSellCny,
    WHATSTOKEN_DURATION_VIDEO_MODELS,
    WHATSTOKEN_IMAGE_MODELS,
    WHATSTOKEN_TEXT_MODELS,
    WHATSTOKEN_VIDEO_MODELS,
    whatsTokenDurationVideoFeatures,
    whatsTokenDurationVideoPriceRows,
    whatsTokenDurationVideoRequiresRatio,
    whatsTokenDurationVideoResolution,
    whatsTokenImageFeatures,
    whatsTokenImagePriceRows,
    whatsTokenTextPriceRows,
    whatsTokenVideoFeatures,
    whatsTokenVideoPriceRows,
} from "./whatstoken-catalog";

describe("WhatsToken catalog prices", () => {
    it("converts upstream USD to sell CNY at 7.2 × 1.3 without using Number", () => {
        expect(usdToSellCny("0.054")).toBe("0.505440");
        expect(usdToSellCny("0.108")).toBe("1.010880");
        expect(usdToSellCny("0.0036")).toBe("0.033696");
        expect(usdToSellCny("0.042")).toBe("0.393120");
        expect(usdToSellCny("0.048")).toBe("0.449280");
        expect(usdToSellCny("0.036")).toBe("0.336960");
    });

    it("seeds Pro pixel tiers and extra-reference from the second image", () => {
        const model = WHATSTOKEN_IMAGE_MODELS.find((item) => item.name === "seedream-5.0-pro-NSFW")!;
        expect(whatsTokenImageFeatures(model).resolutions).toEqual(["1K", "2K", "4K"]);
        expect(whatsTokenImagePriceRows(model)).toEqual([
            { spec: null, unitPrice: "1.010880", extraReferencePrice: "0.033696", billingMode: "per_image" },
            { spec: "1K", unitPrice: "0.505440", extraReferencePrice: "0.033696", billingMode: "per_image" },
            { spec: "2K", unitPrice: "1.010880", extraReferencePrice: "0.033696", billingMode: "per_image" },
            { spec: "4K", unitPrice: "1.010880", extraReferencePrice: "0.033696", billingMode: "per_image" },
        ]);
    });

    it("seeds flat image models at 2K/4K with no extra-reference surcharge", () => {
        const lite = WHATSTOKEN_IMAGE_MODELS.find((item) => item.name === "seedream-5.0-lite-NSFW")!;
        expect(whatsTokenImageFeatures(lite).resolutions).toEqual(["2K", "4K"]);
        expect(whatsTokenImagePriceRows(lite)).toEqual([
            { spec: null, unitPrice: "0.393120", extraReferencePrice: "0.000000", billingMode: "per_image" },
            { spec: "2K", unitPrice: "0.393120", extraReferencePrice: "0.000000", billingMode: "per_image" },
            { spec: "4K", unitPrice: "0.393120", extraReferencePrice: "0.000000", billingMode: "per_image" },
        ]);
    });

    it("converts Seedance token rates to CNY per second from encoder grids, not (res/1080)²", () => {
        const twoFive = WHATSTOKEN_VIDEO_MODELS.find((item) => item.name === "seedance-2-5-NSFW")!;
        const rows = whatsTokenVideoPriceRows(twoFive);
        const without = rows.find((row) => row.spec === "720")!;
        const withVideo = rows.find((row) => row.spec === "720-video")!;
        expect(without.unitPrice).toBe("2.474796");
        expect(withVideo.unitPrice).toBe("1.480252");
        expect(without.unitPrice).not.toBe(withVideo.unitPrice);
        expect(without.billingMode).toBe("per_second");
        expect(rows.find((row) => row.spec === null)?.unitPrice).toBe(without.unitPrice);

        const pro = WHATSTOKEN_VIDEO_MODELS.find((item) => item.name === "seedance-2-0-pro-NSFW")!;
        const proRows = whatsTokenVideoPriceRows(pro);
        expect(proRows.find((row) => row.spec === "720")?.unitPrice).toBe("1.619025");
        expect(proRows.find((row) => row.spec === "480")?.unitPrice).toBe("0.789699");
        expect(proRows.find((row) => row.spec === "720-video")?.unitPrice).toBe("0.994544");
    });

    it("matches WhatsToken 480p usage logs and sells at 7.2 × 1.3 on those tokens", () => {
        expect(seedanceTokensFor(480, 12).toString()).toBe("120946");
        expect(seedanceTokensFor(480, 10).toString()).toBe("100858");
        expect(seedanceTokensFor(720, 12).toString()).toBe("247962");
        expect(seedanceSellCnyFromTokens("8.4", 120946)).toBe("9.509259");
        expect(seedanceCatalogSellCny("seedance-2-0-pro-NSFW", "480", 12)).toBe("9.509259");
        expect(seedanceCatalogSellCny("seedance-2-0-pro-NSFW", "720", 12)).toBe("19.495765");
    });

    it("exposes 4K as 2160 on Pro and keeps fast/mini at 480/720", () => {
        const pro = WHATSTOKEN_VIDEO_MODELS.find((item) => item.name === "seedance-2-0-pro-NSFW")!;
        expect(whatsTokenVideoFeatures(pro).videoResolutions).toEqual(["720", "480", "1080", "2160"]);
        expect(whatsTokenVideoFeatures(pro).aspectPresets.find((item) => item.ratio === "16:9")?.sizes["1K"]).toBe("1280x720");
        expect(whatsTokenVideoPriceRows(pro).some((row) => row.spec === "2160-video")).toBe(true);

        const mini = WHATSTOKEN_VIDEO_MODELS.find((item) => item.name === "seedance-2-0-mini-NSFW")!;
        expect(whatsTokenVideoFeatures(mini).videoResolutions).toEqual(["720", "480"]);
    });

    it("prices GPT Image 2 tiers from the output image tokens measured upstream", () => {
        // 1024×1024 costs 196 / 1756 / 7024 output tokens at low / medium / high, billed $32.4/1M.
        const stable = WHATSTOKEN_IMAGE_MODELS.find((item) => item.name === "gpt-image-2-stable")!;
        const rows = whatsTokenImagePriceRows(stable);
        expect(rows.find((row) => row.spec === "1K")?.unitPrice).toBe("0.059440");
        expect(rows.find((row) => row.spec === "2K")?.unitPrice).toBe("0.532532");
        expect(rows.find((row) => row.spec === "4K")?.unitPrice).toBe("2.130126");
        // auto (null spec) must bill the top tier: that is what quality=high sends upstream.
        expect(rows.find((row) => row.spec === null)?.unitPrice).toBe("2.130126");
    });

    it("prices the flat-rate and directly-priced image models without deriving from tokens", () => {
        const special = WHATSTOKEN_IMAGE_MODELS.find((item) => item.name === "gpt-image-2-special")!;
        const specialRows = whatsTokenImagePriceRows(special);
        for (const spec of ["1K", "2K", "4K"]) {
            expect(specialRows.find((row) => row.spec === spec)?.unitPrice).toBe("0.328321");
        }

        const gemini = WHATSTOKEN_IMAGE_MODELS.find((item) => item.name === "gemini-3.1-flash-lite-image")!;
        expect(whatsTokenImageFeatures(gemini).resolutions).toEqual(["1K"]);
        expect(whatsTokenImagePriceRows(gemini)).toEqual([
            { spec: null, unitPrice: "0.200000", extraReferencePrice: "0.000000", billingMode: "per_image" },
            { spec: "1K", unitPrice: "0.200000", extraReferencePrice: "0.000000", billingMode: "per_image" },
        ]);
    });

    it("prices duration-billed video per second and keeps the -video spec at the same rate", () => {
        const h3 = WHATSTOKEN_DURATION_VIDEO_MODELS.find((item) => item.name === "MiniMax-H3")!;
        const rows = whatsTokenDurationVideoPriceRows(h3);
        // $0.092308/s × 7.2 × 1.3, and 2K recorded as 1440 so the feature list stays numeric.
        expect(rows.find((row) => row.spec === "768")?.unitPrice).toBe("0.864003");
        expect(rows.find((row) => row.spec === "768-video")?.unitPrice).toBe("0.864003");
        expect(rows.find((row) => row.spec === "1440")?.unitPrice).toBe("1.382397");
        expect(rows.every((row) => row.billingMode === "per_second")).toBe(true);
        expect(rows.find((row) => row.spec === "768")?.extraReferencePrice).toBe("0.345599");
        expect(whatsTokenDurationVideoFeatures(h3).videoResolutions).toEqual(["768", "1440"]);

        const horse = WHATSTOKEN_DURATION_VIDEO_MODELS.find((item) => item.name === "happyhorse-1.1-t2v")!;
        const horseRows = whatsTokenDurationVideoPriceRows(horse);
        expect(horseRows.find((row) => row.spec === "720")?.unitPrice).toBe("1.010880");
        expect(horseRows.find((row) => row.spec === "1080")?.unitPrice).toBe("1.797120");
    });

    it("maps stored resolutions onto the vocabulary each duration model accepts", () => {
        expect(whatsTokenDurationVideoResolution("MiniMax-H3", "768")).toBe("768P");
        expect(whatsTokenDurationVideoResolution("MiniMax-H3", "1440")).toBe("2k");
        // Anything unsupported falls back to the model's first rate rather than sending 720p.
        expect(whatsTokenDurationVideoResolution("MiniMax-H3", "720")).toBe("768P");
        expect(whatsTokenDurationVideoResolution("happyhorse-1.1-i2v", "1080")).toBe("1080p");
        expect(whatsTokenDurationVideoResolution("seedance-2-5-NSFW", "720")).toBeUndefined();
        expect(whatsTokenDurationVideoRequiresRatio("MiniMax-H3")).toBe(true);
        expect(whatsTokenDurationVideoRequiresRatio("happyhorse-1.1-t2v")).toBe(false);
    });

    it("prices chat models per 1M tokens on the higher upstream tier", () => {
        const rows = whatsTokenTextPriceRows(WHATSTOKEN_TEXT_MODELS.find((item) => item.name === "seed-sc-NSFW")!);
        // $0.48 / $1.92 per 1M is the ≤128k tier, deliberately above the ≤32k headline rate.
        expect(rows.find((row) => row.spec === "input")?.unitPrice).toBe("4.492800");
        expect(rows.find((row) => row.spec === "output")?.unitPrice).toBe("17.971200");
        expect(rows.every((row) => row.billingMode === "per_token")).toBe(true);

        const deepseek = whatsTokenTextPriceRows(WHATSTOKEN_TEXT_MODELS.find((item) => item.name === "deepseek-v4-flash")!);
        expect(deepseek.find((row) => row.spec === "input")?.unitPrice).toBe("1.727996");
        expect(deepseek.find((row) => row.spec === "output")?.unitPrice).toBe("3.456002");
    });

    it("seeds every model the upstream cannot currently serve as disabled", () => {
        const disabled = [
            ...WHATSTOKEN_IMAGE_MODELS.filter((item) => item.enabled === false).map((item) => item.name),
            ...WHATSTOKEN_DURATION_VIDEO_MODELS.filter((item) => item.enabled === false).map((item) => item.name),
            ...WHATSTOKEN_TEXT_MODELS.filter((item) => item.enabled === false).map((item) => item.name),
        ].sort();
        expect(disabled).toEqual(
            ["MiniMax-H3-special", "deepseek-v4-flash-ga", "gpt-image-2", "happyhorse-1.1-i2v", "happyhorse-1.1-r2v", "happyhorse-1.1-t2v", "seed-sc-NSFW"].sort(),
        );
    });

    it("picks 720 vs 720-video from resolution and whether a video reference is present", () => {
        expect(videoPricingSpec("720p", false)).toBe("720");
        expect(videoPricingSpec("720p", true)).toBe("720-video");
        expect(videoPricingSpec("4k", true)).toBe("2160-video");
        expect(videoPricingSpec(undefined, false)).toBe("720");
        expect(videoPricingSpec("480", false)).toBe("480");
        expect(videoPricingSpec("480", false, "seedance-2-0-pro-NSFW")).toBe("480");
        expect(videoPricingSpec("480p", true, "seedance-2-0-fast-NSFW")).toBe("480-video");
    });
});
