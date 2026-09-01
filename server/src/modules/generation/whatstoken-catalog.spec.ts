import { describe, expect, it } from "vitest";
import { videoPricingSpec } from "./video-pricing-spec";
import {
    usdToSellCny,
    WHATSTOKEN_IMAGE_MODELS,
    WHATSTOKEN_VIDEO_MODELS,
    whatsTokenImageFeatures,
    whatsTokenImagePriceRows,
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

    it("converts Seedance token rates to CNY per second at 720p", () => {
        const twoFive = WHATSTOKEN_VIDEO_MODELS.find((item) => item.name === "seedance-2-5-NSFW")!;
        const rows = whatsTokenVideoPriceRows(twoFive);
        const without = rows.find((row) => row.spec === "720")!;
        const withVideo = rows.find((row) => row.spec === "720-video")!;
        expect(without.unitPrice).toBe("1.099909");
        expect(withVideo.unitPrice).toBe("0.657890");
        expect(without.unitPrice).not.toBe(withVideo.unitPrice);
        expect(without.billingMode).toBe("per_second");
        expect(rows.find((row) => row.spec === null)?.unitPrice).toBe(without.unitPrice);
    });

    it("exposes 4K as 2160 on Pro and keeps fast/mini at 480/720", () => {
        const pro = WHATSTOKEN_VIDEO_MODELS.find((item) => item.name === "seedance-2-0-pro-NSFW")!;
        expect(whatsTokenVideoFeatures(pro).videoResolutions).toEqual(["480", "720", "1080", "2160"]);
        expect(whatsTokenVideoFeatures(pro).aspectPresets.find((item) => item.ratio === "16:9")?.sizes["1K"]).toBe("1280x720");
        expect(whatsTokenVideoPriceRows(pro).some((row) => row.spec === "2160-video")).toBe(true);

        const mini = WHATSTOKEN_VIDEO_MODELS.find((item) => item.name === "seedance-2-0-mini-NSFW")!;
        expect(whatsTokenVideoFeatures(mini).videoResolutions).toEqual(["480", "720"]);
    });

    it("picks 720 vs 720-video from resolution and whether a video reference is present", () => {
        expect(videoPricingSpec("720p", false)).toBe("720");
        expect(videoPricingSpec("720p", true)).toBe("720-video");
        expect(videoPricingSpec("4k", true)).toBe("2160-video");
        expect(videoPricingSpec(undefined, false)).toBe("720");
    });
});
