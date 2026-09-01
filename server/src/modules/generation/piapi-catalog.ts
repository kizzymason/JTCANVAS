import { mulMoney, toMoneyString } from "../../common/money";
import { parseModelFeatures, type ModelFeatures } from "../pricing/model-features";

/** Upstream host used by the PiAPI adapter and the seeded channel. */
export const PIAPI_BASE_URL = "https://api.piapi.ai";

/** The image model users get when they have not picked one themselves. */
export const DEFAULT_PIAPI_IMAGE_MODEL = "seedream-5-pro-less-restriction";

/**
 * Published Seedream list prices are USD. Wallet billing is CNY NUMERIC(18,6).
 * 7.2 is a fixed list conversion so a $0.052 image becomes ¥0.374400; admins can override per spec.
 */
export const PIAPI_USD_TO_CNY = "7.2";

export const PIAPI_SEEDREAM_MODELS = [
    {
        name: "seedream-5-lite",
        displayName: "Seedream 5 Lite",
        sizes: { "2K": "0.052", "3K": "0.052" },
        extraReferenceUsd: "0",
    },
    {
        name: "seedream-5-lite-less-restriction",
        displayName: "Seedream 5 Lite 宽松",
        sizes: { "2K": "0.065", "3K": "0.065" },
        extraReferenceUsd: "0",
    },
    {
        name: "seedream-5-pro",
        displayName: "Seedream 5 Pro",
        sizes: { "1K": "0.068", "2K": "0.136" },
        extraReferenceUsd: "0.003",
    },
    {
        name: "seedream-5-pro-less-restriction",
        displayName: "Seedream 5 Pro 宽松",
        sizes: { "1K": "0.085", "2K": "0.17" },
        extraReferenceUsd: "0.003",
    },
] as const;

export type PiapiSeedreamModel = (typeof PIAPI_SEEDREAM_MODELS)[number];

export type PiapiSeedPriceRow = {
    spec: string | null;
    unitPrice: string;
    extraReferencePrice: string;
};

export function usdToCny(usd: string) {
    return toMoneyString(mulMoney(usd, PIAPI_USD_TO_CNY));
}

/** UI resolutions for a Seedream task type: lite bills 2K/3K (shown as 2K/4K), pro bills 1K/2K. */
export function piapiSeedFeatures(model: PiapiSeedreamModel): ModelFeatures {
    const specs = Object.keys(model.sizes);
    const resolutions: string[] = [];
    if (specs.includes("1K")) resolutions.push("1K");
    if (specs.includes("2K")) resolutions.push("2K");
    if (specs.includes("3K") || specs.includes("4K")) resolutions.push("4K");
    return parseModelFeatures({
        resolutions,
        maxCount: 1,
        supportsTransparent: false,
    });
}

/** Default (null spec) plus each published size tier, all in CNY strings. */
export function piapiSeedPriceRows(model: PiapiSeedreamModel): PiapiSeedPriceRow[] {
    const extra = usdToCny(model.extraReferenceUsd);
    const sizes = Object.entries(model.sizes);
    const defaultUsd = sizes[0]?.[1] ?? "0";
    return [
        { spec: null, unitPrice: usdToCny(defaultUsd), extraReferencePrice: extra },
        ...sizes.map(([spec, usd]) => ({ spec, unitPrice: usdToCny(usd), extraReferencePrice: extra })),
    ];
}
