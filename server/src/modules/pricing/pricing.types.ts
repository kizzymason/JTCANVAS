import type { ModelFeatures } from "./model-features";

export type Capability = "image" | "video" | "text" | "audio";
export type BillingMode = "per_image" | "per_second" | "per_call";
export type ApiFormat = "openai" | "gemini" | "piapi";

/** What the frontend needs to render a model picker and compute an estimate locally. */
export type PublicModel = {
    /** `channelId::modelName`, the same composite format the canvas already stores. */
    value: string;
    channelId: string;
    modelName: string;
    displayName: string;
    capability: Capability;
    apiFormat: ApiFormat;
    billingMode: BillingMode;
    /** Price for the default spec, in CNY. */
    unitPrice: string;
    extraReferencePrice: string;
    minCharge: string;
    /** Per-spec overrides, e.g. { "1K": "0.085", "2K": "0.17" }. */
    specPrices: Record<string, string>;
    /** Resolved generation options the UI should honour for this model. */
    features: ModelFeatures;
};

export type EstimateRequest = {
    model: string;
    /** Images requested, or seconds for video. */
    count?: number;
    seconds?: number;
    /** Size or quality tier used to pick a spec price. */
    spec?: string;
    referenceCount?: number;
};

export type EstimateResult = {
    model: string;
    billingMode: BillingMode;
    unitPrice: string;
    quantity: number;
    /** Total in CNY, already rounded up to the storage scale. */
    amount: string;
};

export const CHANNEL_MODEL_SEPARATOR = "::";

export function encodeModelValue(channelId: string, modelName: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${modelName}`;
}

export function decodeModelValue(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return { channelId: "", modelName: value };
    return { channelId: value.slice(0, index), modelName: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}
