import type { ModelFeatures } from "./model-features";

export type Capability = "image" | "video" | "text" | "audio";
export type BillingMode = "per_image" | "per_second" | "per_call" | "per_token";
export type ApiFormat = "openai" | "gemini" | "piapi";

/** Token prices are quoted per 1M tokens, the unit every upstream price list uses. */
export const TOKEN_PRICE_UNIT = 1_000_000;
export const TOKEN_SPEC_INPUT = "input";
export const TOKEN_SPEC_OUTPUT = "output";

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
    /** CNY per 1M tokens for `per_token` models; both zero for every other billing mode. */
    tokenPrices: import("./token-pricing").TokenPrices;
    /** Public sell rate per encoded million tokens, scoped to this channel's price rows. */
    videoTokenPrices?: Record<string, string>;
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
    /** `per_token` only: prompt tokens counted before the call. */
    inputTokens?: number;
    /** `per_token` only: the output ceiling used to freeze, so the settle can never exceed it. */
    maxOutputTokens?: number;
};

export type EstimateOptions = {
    /** Reseller coefficient, e.g. "1.200000". Defaults to the public price. */
    multiplier?: string;
};

export type EstimateResult = {
    model: string;
    billingMode: BillingMode;
    /** Price per billable unit *after* the reseller coefficient, in CNY. */
    unitPrice: string;
    quantity: number;
    /** Total in CNY, already rounded up to the storage scale. */
    amount: string;
    /** Coefficient that produced `amount`, so callers can snapshot it onto the task. */
    multiplier: string;
    /** `per_token` only: the token volumes the freeze was built from. */
    inputTokens?: number;
    maxOutputTokens?: number;
    tokenPrices?: import("./token-pricing").TokenPrices;
    videoTokenPrice?: string;
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
