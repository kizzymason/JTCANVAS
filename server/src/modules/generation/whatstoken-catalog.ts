import { money, mulMoney, toMoneyString } from "../../common/money";
import { defaultVideoAspectPresets } from "../pricing/aspect-presets";
import { parseModelFeatures, type ModelFeatures } from "../pricing/model-features";

/** Upstream host used by the seeded OpenAI-compatible channel. */
export const WHATSTOKEN_BASE_URL = "https://www.whatstoken.ai";
export const WHATSTOKEN_CHANNEL_NAME = "WhatsToken";

/**
 * Published WhatsToken list prices are USD. Wallet billing is CNY NUMERIC(18,6).
 * 7.2 matches the PiAPI list conversion; 1.3 is the required sell markup (30% gross).
 * $1 upstream → ¥7.2 cost → ¥9.36 sell.
 */
export const WHATSTOKEN_USD_TO_CNY = "7.2";
export const WHATSTOKEN_MARKUP = "1.3";

/**
 * Seedance bills output tokens. Official-ish volume: 15s at 1080p ≈ 308,880 tokens → 20,592 tok/s.
 * Other resolutions scale with pixel area `(res / 1080)²`. 4K uses 2160.
 */
export const SEEDANCE_TOKENS_PER_SECOND_1080 = "20592";

export type WhatsTokenImageModel = {
    name: string;
    displayName: string;
    /** Upstream USD per image keyed by the 1K/2K/4K UI tier. */
    sizes: Record<string, string>;
    extraReferenceUsd: string;
    /** Null-spec default; auto quality uses this so we do not under-charge. */
    defaultSize: string;
};

export type WhatsTokenVideoRate = {
    resolution: number;
    /** Cheaper $/1M tokens when the request includes a video reference (含视). */
    withVideoUsdPerM: string;
    /** $/1M tokens with no video input (无视): text-to-video or image-to-video. */
    withoutVideoUsdPerM: string;
};

export type WhatsTokenVideoModel = {
    name: string;
    displayName: string;
    maxSeconds: number;
    rates: WhatsTokenVideoRate[];
};

export type WhatsTokenSeedPriceRow = {
    spec: string | null;
    unitPrice: string;
    extraReferencePrice: string;
    billingMode: "per_image" | "per_second";
};

export const WHATSTOKEN_IMAGE_MODELS: WhatsTokenImageModel[] = [
    {
        name: "seedream-5.0-pro-NSFW",
        displayName: "Seedream 5.0 Pro",
        // ≤2.36M pixels → $0.054 (1K). Larger 2K/4K outputs sit in the ≤100M tier → $0.108.
        sizes: { "1K": "0.054", "2K": "0.108", "4K": "0.108" },
        extraReferenceUsd: "0.0036",
        defaultSize: "4K",
    },
    {
        name: "seedream-5.0-lite-NSFW",
        displayName: "Seedream 5.0 Lite",
        sizes: { "2K": "0.042", "4K": "0.042" },
        extraReferenceUsd: "0",
        defaultSize: "2K",
    },
    {
        name: "seedream-4.5-NSFW",
        displayName: "Seedream 4.5",
        sizes: { "2K": "0.048", "4K": "0.048" },
        extraReferenceUsd: "0",
        defaultSize: "2K",
    },
    {
        name: "seedream-4-0-NSFW",
        displayName: "Seedream 4.0",
        sizes: { "2K": "0.036", "4K": "0.036" },
        extraReferenceUsd: "0",
        defaultSize: "2K",
    },
];

export const WHATSTOKEN_VIDEO_MODELS: WhatsTokenVideoModel[] = [
    {
        name: "seedance-2-5-NSFW",
        displayName: "Seedance 2.5",
        maxSeconds: 15,
        rates: [
            { resolution: 480, withVideoUsdPerM: "7.68", withoutVideoUsdPerM: "12.84" },
            { resolution: 720, withVideoUsdPerM: "7.68", withoutVideoUsdPerM: "12.84" },
            { resolution: 1080, withVideoUsdPerM: "8.4", withoutVideoUsdPerM: "14.04" },
        ],
    },
    {
        name: "seedance-2-0-pro-NSFW",
        displayName: "Seedance 2.0 Pro",
        maxSeconds: 15,
        rates: [
            { resolution: 480, withVideoUsdPerM: "5.16", withoutVideoUsdPerM: "8.4" },
            { resolution: 720, withVideoUsdPerM: "5.16", withoutVideoUsdPerM: "8.4" },
            { resolution: 1080, withVideoUsdPerM: "5.64", withoutVideoUsdPerM: "9.24" },
            { resolution: 2160, withVideoUsdPerM: "2.88", withoutVideoUsdPerM: "4.8" },
        ],
    },
    {
        name: "seedance-2-0-fast-NSFW",
        displayName: "Seedance 2.0 Fast",
        maxSeconds: 15,
        rates: [
            { resolution: 480, withVideoUsdPerM: "3.96", withoutVideoUsdPerM: "6.72" },
            { resolution: 720, withVideoUsdPerM: "3.96", withoutVideoUsdPerM: "6.72" },
        ],
    },
    {
        name: "seedance-2-0-mini-NSFW",
        displayName: "Seedance 2.0 Mini",
        maxSeconds: 15,
        rates: [
            { resolution: 480, withVideoUsdPerM: "2.52", withoutVideoUsdPerM: "4.2" },
            { resolution: 720, withVideoUsdPerM: "2.52", withoutVideoUsdPerM: "4.2" },
        ],
    },
];

export function usdToSellCny(usd: string) {
    return toMoneyString(mulMoney(mulMoney(usd, WHATSTOKEN_USD_TO_CNY), WHATSTOKEN_MARKUP));
}

export function seedanceTokensPerSecond(resolution: number) {
    return money(SEEDANCE_TOKENS_PER_SECOND_1080).times(money(resolution).div(1080).pow(2));
}

/** Sell CNY per second from a published $/1M-token rate at the given output height. */
export function seedanceSellCnyPerSecond(usdPerMillion: string, resolution: number) {
    const usdPerSecond = seedanceTokensPerSecond(resolution).div(1_000_000).times(usdPerMillion);
    return toMoneyString(mulMoney(mulMoney(usdPerSecond, WHATSTOKEN_USD_TO_CNY), WHATSTOKEN_MARKUP));
}

export function whatsTokenImageFeatures(model: WhatsTokenImageModel): ModelFeatures {
    const specs = Object.keys(model.sizes);
    const resolutions: string[] = [];
    if (specs.includes("1K")) resolutions.push("1K");
    if (specs.includes("2K")) resolutions.push("2K");
    if (specs.includes("4K")) resolutions.push("4K");
    return parseModelFeatures({
        resolutions,
        maxCount: 1,
        supportsTransparent: false,
    });
}

export function whatsTokenVideoFeatures(model: WhatsTokenVideoModel): ModelFeatures {
    return parseModelFeatures({
        videoResolutions: model.rates.map((rate) => String(rate.resolution)),
        maxSeconds: model.maxSeconds,
        aspectPresets: defaultVideoAspectPresets(),
    });
}

export function whatsTokenImagePriceRows(model: WhatsTokenImageModel): WhatsTokenSeedPriceRow[] {
    const extra = usdToSellCny(model.extraReferenceUsd);
    const defaultUsd = model.sizes[model.defaultSize] ?? Object.values(model.sizes)[0] ?? "0";
    return [
        { spec: null, unitPrice: usdToSellCny(defaultUsd), extraReferencePrice: extra, billingMode: "per_image" },
        ...Object.entries(model.sizes).map(([spec, usd]) => ({
            spec,
            unitPrice: usdToSellCny(usd),
            extraReferencePrice: extra,
            billingMode: "per_image" as const,
        })),
    ];
}

export function whatsTokenVideoPriceRows(model: WhatsTokenVideoModel): WhatsTokenSeedPriceRow[] {
    const defaultRate = model.rates.find((rate) => rate.resolution === 720) ?? model.rates[0];
    const rows: WhatsTokenSeedPriceRow[] = [
        {
            spec: null,
            unitPrice: seedanceSellCnyPerSecond(defaultRate.withoutVideoUsdPerM, defaultRate.resolution),
            extraReferencePrice: usdToSellCny("0"),
            billingMode: "per_second",
        },
    ];
    for (const rate of model.rates) {
        rows.push({
            spec: String(rate.resolution),
            unitPrice: seedanceSellCnyPerSecond(rate.withoutVideoUsdPerM, rate.resolution),
            extraReferencePrice: usdToSellCny("0"),
            billingMode: "per_second",
        });
        rows.push({
            spec: `${rate.resolution}-video`,
            unitPrice: seedanceSellCnyPerSecond(rate.withVideoUsdPerM, rate.resolution),
            extraReferencePrice: usdToSellCny("0"),
            billingMode: "per_second",
        });
    }
    return rows;
}
