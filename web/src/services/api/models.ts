import Decimal from "decimal.js";

import { apiGet, apiPost } from "./client";

export type ModelCapability = "image" | "video" | "text" | "audio";
export type BillingMode = "per_image" | "per_second" | "per_call";

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
    features?: {
        resolutions: Array<"1K" | "2K" | "4K">;
        maxCount: number;
        supportsTransparent: boolean;
        aspectRatios: string[];
        aspectPresets?: Array<{ ratio: string; label: string; sizes: Partial<Record<"1K" | "2K" | "4K", string>> }>;
        videoResolutions: string[];
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
export function estimateLocally(model: PublicModel | undefined, input: { count?: number; seconds?: number; spec?: string; referenceCount?: number }): string {
    if (!model) return "";
    const unitPrice = new Decimal(lookupSpecPrice(model.specPrices, input.spec, model.unitPrice));
    const quantity = model.billingMode === "per_second" ? Math.ceil(input.seconds ?? 0) * Math.max(1, input.count ?? 1) : Math.max(1, Math.floor(input.count ?? 1));
    if (model.billingMode === "per_second" && !input.seconds) return "";

    const extras = new Decimal(model.extraReferencePrice).times(Math.max(0, (input.referenceCount ?? 0) - 1));
    const raw = unitPrice.times(quantity).plus(extras);
    const minCharge = new Decimal(model.minCharge);
    return (raw.lessThan(minCharge) ? minCharge : raw).toFixed(2, Decimal.ROUND_UP);
}

/** Formats a decimal string for display: two decimals, CNY convention. */
export function formatMoney(value: string | number | undefined) {
    if (value === undefined || value === "") return "0.00";
    return new Decimal(value).toFixed(2, Decimal.ROUND_HALF_UP);
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
