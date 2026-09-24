import Decimal from "decimal.js";

import { apiGet, apiPost } from "./client";
export { formatMoney } from "@/lib/format-money";

export type ModelCapability = "image" | "video" | "text" | "audio";
export type BillingMode = "per_image" | "per_second" | "per_call" | "per_token";

export type PublicModel = {
    /** `channelId::modelName`, the same composite value the canvas already stores per node. */
    value: string;
    channelId: string;
    modelName: string;
    displayName: string;
    capability: ModelCapability;
    apiFormat: "openai" | "gemini" | "piapi";
    billingMode: BillingMode;
    unitPrice: string;
    extraReferencePrice: string;
    minCharge: string;
    specPrices: Record<string, string>;
    videoTokenPrices?: Record<string, string>;
    tokenPrices?: { input: string; output: string; cacheRead?: string; cacheWrite?: string; peakHours?: boolean; tiers?: Array<{ maxInputTokens: number; input: string; output: string; cacheRead?: string; cacheWrite?: string }> };
    features?: {
        resolutions: Array<"1K" | "2K" | "4K">;
        maxCount: number;
        supportsTransparent: boolean;
        aspectRatios: string[];
        aspectPresets?: Array<{ ratio: string; label: string; sizes: Partial<Record<"1K" | "2K" | "4K", string>> }>;
        videoResolutions: string[];
        minSeconds?: number;
        maxSeconds: number;
    };
};

export type EstimateResult = {
    model: string;
    billingMode: BillingMode;
    unitPrice: string;
    quantity: number;
    amount: string;
};

export function fetchModels(capability?: ModelCapability) {
    return apiGet<{ models: PublicModel[] }>("/models", { params: capability ? { capability } : undefined });
}

/** Authoritative estimate. Used for confirmation dialogs; the inline hint is computed locally. */
export function requestEstimate(body: { model: string; count?: number; seconds?: number; spec?: string; referenceCount?: number }) {
    return apiPost<EstimateResult>("/estimate", body);
}

/**
 * Mirrors the server's pricing maths so the workbench can show a live estimate without a round-trip
 * on every keystroke. The server always recomputes before charging, so a drift here is cosmetic.
 */
export function estimateLocally(model: PublicModel | undefined, input: { count?: number; seconds?: number; spec?: string; referenceCount?: number; taskCount?: number }): string {
    if (!model || model.billingMode === "per_token") return "";
    if (model.billingMode === "per_second" && !input.seconds) return "";
    // Every independent task has its own reference surcharge and minimum charge.
    if (input.taskCount && input.taskCount > 1) {
        return new Decimal(estimateLocally(model, { ...input, taskCount: 1 })).times(input.taskCount).toFixed(2, Decimal.ROUND_UP);
    }
    const unitPrice = new Decimal(lookupSpecPrice(model.specPrices, input.spec, model.unitPrice));
    const quantity = model.billingMode === "per_second" ? Math.ceil(input.seconds ?? 0) * Math.max(1, input.count ?? 1) : Math.max(1, Math.floor(input.count ?? 1));
    if (model.billingMode === "per_second" && !input.seconds) return "";

    const extras = new Decimal(model.extraReferencePrice).times(Math.max(0, (input.referenceCount ?? 0) - 1));
    let raw = unitPrice.times(quantity).plus(extras);
    const videoRate = model.videoTokenPrices?.[input.spec ?? "720"];
    if (model.billingMode === "per_second" && videoRate) {
        const resolution = Number((input.spec ?? "720").replace(/-video$/, ""));
        const [w, h] = resolution >= 2160 ? [3840, 2160] : resolution >= 1080 ? [1920, 1088] : resolution >= 720 ? [1248, 704] : [864, 496];
        const tokens = new Decimal(w).times(h).times(new Decimal(input.seconds ?? 0).times(24).plus(1)).div(1024).floor().times(Math.max(1, input.count ?? 1));
        raw = tokens.div(1_000_000).times(videoRate).plus(extras);
    }
    const minCharge = new Decimal(model.minCharge);
    return (raw.lessThan(minCharge) ? minCharge : raw).toFixed(2, Decimal.ROUND_UP);
}

/** True when the wallet cannot cover the shown estimate, used to disable the generate button. */
export function canAfford(balance: string | undefined, estimate: string) {
    if (!estimate) return true;
    return new Decimal(balance || 0).gte(new Decimal(estimate));
}

/** PiAPI lite bills 3K where the shared quality map says 4K; pro clamps 3K/4K down to 2K. Video 含视 falls back to 无视 of the same resolution. */
function lookupSpecPrice(specPrices: Record<string, string>, spec: string | undefined, fallback: string) {
    if (!spec) return fallback;
    if (specPrices[spec]) return specPrices[spec];
    if (spec.endsWith("-video")) {
        const without = spec.slice(0, -"-video".length);
        if (specPrices[without]) return specPrices[without];
    }
    if (spec === "4K") return specPrices["3K"] ?? specPrices["2K"] ?? fallback;
    if (spec === "3K") return specPrices["2K"] ?? fallback;
    return fallback;
}
