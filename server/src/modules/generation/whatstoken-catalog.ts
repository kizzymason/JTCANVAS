import { ceilMoney, money, mulMoney, toMoneyString } from "../../common/money";
import { defaultVideoAspectPresets } from "../pricing/aspect-presets";
import { parseModelFeatures, type ModelFeatures } from "../pricing/model-features";
import { VIDEO_INPUT_SPEC_SUFFIX, normalizeVideoPricingResolution } from "./video-pricing-spec";

/** Upstream host used by the seeded OpenAI-compatible channel. */
export const WHATSTOKEN_BASE_URL = "https://www.whatstoken.ai";
export const WHATSTOKEN_CHANNEL_NAME = "WhatsToken";

/**
 * Published WhatsToken list prices are USD. Wallet billing is CNY NUMERIC(18,6).
 * 7.2 matches the PiAPI list conversion; 1.3 is the default cost-plus multiplier (30% above cost).
 * $1 upstream → ¥7.2 cost → ¥9.36 sell.
 */
export const WHATSTOKEN_USD_TO_CNY = "7.2";
export const WHATSTOKEN_MARKUP = "1.3";

/**
 * Seedance bills output tokens from the encoded pixel grid, not the UI height squared.
 * tokens = floor(W × H × (24 × seconds + 1) / 1024). 720p is 1248×704 = 20,592 tok/s;
 * treating 20,592 as a 1080p baseline under-charged every resolution.
 *
 * Grids match WhatsToken usage (12s 480p = 120,946; 10s 480p = 100,858) and the
 * published 2.0/2.5 encoder sizes.
 */
export const SEEDANCE_ENCODER = {
    480: { width: 864, height: 496 },
    720: { width: 1248, height: 704 },
    1080: { width: 1920, height: 1088 },
    2160: { width: 3840, height: 2160 },
} as const;

export type WhatsTokenImageModel = {
    name: string;
    displayName: string;
    /** Upstream USD per image keyed by the 1K/2K/4K UI tier. */
    sizes: Record<string, string>;
    /**
     * Sell price in CNY per image, keyed the same way. Set only when the upstream price cannot be
     * derived from a published USD-per-image rate — currently just the Gemini image model, which
     * bills per token but reports no usage, so there is nothing to convert from.
     */
    sizesCny?: Record<string, string>;
    extraReferenceUsd: string;
    /** Null-spec default; auto quality uses this so we do not under-charge. */
    defaultSize: string;
    /** Seeded as disabled while the upstream has no channel serving the model. */
    enabled?: boolean;
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
    billingMode: "per_image" | "per_second" | "per_token";
};

/**
 * Video models the upstream prices by wall-clock duration rather than encoder tokens. There is no
 * token formula to reconcile against, so the per-second rate is the whole story and settlement falls
 * back to the plain pro-rate path (`seedanceUsdPerMillion` returns nothing for these).
 */
export type WhatsTokenDurationVideoRate = {
    /** Stored on price rows and model features; must stay numeric. 2K is recorded as 1440. */
    resolution: number;
    /** What the upstream expects in `resolution`, e.g. `768P`, `2k`, `1080p`. */
    upstream: string;
    usdPerSecond: string;
};

export type WhatsTokenDurationVideoModel = {
    name: string;
    displayName: string;
    minSeconds: number;
    maxSeconds: number;
    rates: WhatsTokenDurationVideoRate[];
    /** Charged from the second reference image onward. */
    extraReferenceUsd: string;
    /** The upstream rejects text-to-video without an explicit aspect ratio. */
    requiresRatio?: boolean;
    enabled?: boolean;
};

/**
 * Chat models. Our schema carries one input and one output rate, while several upstream models are
 * tiered (the rate doubles past a context threshold) — the higher tier is always the one recorded so
 * a long-context request can never be under-charged.
 */
export type WhatsTokenTextModel = {
    name: string;
    displayName: string;
    /** USD per 1M prompt tokens. */
    inputUsdPerM: string;
    /** USD per 1M completion tokens. */
    outputUsdPerM: string;
    cacheReadUsdPerM?: string;
    cacheWriteUsdPerM?: string;
    tiers?: Array<{ maxInputTokens: number; inputUsdPerM: string; outputUsdPerM: string; cacheReadUsdPerM?: string; cacheWriteUsdPerM?: string }>;
    protocol?: "responses" | "chat";
    peakHours?: boolean;
    enabled?: boolean;
};

export const WHATSTOKEN_IMAGE_MODELS: WhatsTokenImageModel[] = [
    { name: "dola-seedream-5-0-pro", displayName: "Dola Seedream 5.0 Pro", sizes: { "1K": "0.0315", "2K": "0.063", "4K": "0.063" }, extraReferenceUsd: "0.0021", defaultSize: "2K" },
    // pro 系列上游只接受 1K/2K：4K 标签被拒（size 必须为 WIDTHxHEIGHT 或受支持预设），显式像素上限 4,624,220 像素。
    { name: "seedream-5-0-pro", displayName: "Seedream 5.0 Pro 标准", sizes: { "1K": "0.0378", "2K": "0.0756" }, extraReferenceUsd: "0.00252", defaultSize: "2K" },
    { name: "seedream-5-0-spg", displayName: "Seedream 5.0 SPG", sizes: { "2K": "0.0245", "4K": "0.0245" }, extraReferenceUsd: "0", defaultSize: "2K" },
    { name: "seedream-5.0-lite", displayName: "Seedream 5.0 Lite 标准", sizes: { "2K": "0.0126", "4K": "0.0126" }, extraReferenceUsd: "0", defaultSize: "2K" },
    {
        name: "seedream-5.0-pro-NSFW",
        displayName: "Seedream 5.0 Pro",
        // ≤2.36M pixels → $0.054 (1K). Larger 2K outputs sit in the ≤100M tier → $0.108.
        // 上游只认 1K/2K（4K 标签报 400，显式像素上限 4,624,220），故不再提供 4K 档。
        sizes: { "1K": "0.054", "2K": "0.108" },
        extraReferenceUsd: "0.0036",
        defaultSize: "2K",
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
    /*
     * GPT Image 2 bills output image tokens at $32.4/1M. Measured against the upstream at 1024×1024:
     * low = 196, medium = 1756, high = 7024 output tokens, which is exactly the low/medium/high
     * quality axis our 1K/2K/4K tiers already map onto. The USD figures below are those token counts
     * converted, so the per-image price stays tied to what the upstream actually charges.
     * `defaultSize` is the top tier: auto sends `quality: high` upstream, so anything cheaper would
     * under-charge.
     */
    {
        name: "gpt-image-2-stable",
        displayName: "GPT Image 2 Stable",
        sizes: { "1K": "0.0063504", "2K": "0.0568944", "4K": "0.2275776" },
        extraReferenceUsd: "0",
        defaultSize: "4K",
    },
    {
        name: "gpt-image-2",
        displayName: "GPT Image 2",
        sizes: { "1K": "0.0063504", "2K": "0.0568944", "4K": "0.2275776" },
        extraReferenceUsd: "0",
        defaultSize: "4K",
        // Upstream currently answers "deployment does not exist"; enable once it serves again.
        enabled: false,
    },
    {
        // Flat rate upstream: the quality tier does not change what we are charged.
        name: "gpt-image-2-special",
        displayName: "GPT Image 2 Special",
        sizes: { "1K": "0.035077", "2K": "0.035077", "4K": "0.035077" },
        extraReferenceUsd: "0",
        defaultSize: "4K",
    },
    {
        // Token-billed upstream that returns no usage block, so there is nothing to derive a price
        // from; the per-image sell price is set directly instead.
        name: "gemini-3.1-flash-lite-image",
        displayName: "Gemini 3.1 Flash Lite Image",
        sizes: { "1K": "0" },
        sizesCny: { "1K": "0.200000" },
        extraReferenceUsd: "0",
        defaultSize: "1K",
    },
];

export const WHATSTOKEN_DURATION_VIDEO_MODELS: WhatsTokenDurationVideoModel[] = [
    {
        name: "MiniMax-H3",
        displayName: "MiniMax H3",
        minSeconds: 4,
        maxSeconds: 15,
        // The upstream rejects 480p/720p/1080p for this model: only 768P and 2k are accepted.
        rates: [
            { resolution: 768, upstream: "768P", usdPerSecond: "0.092308" },
            { resolution: 1440, upstream: "2k", usdPerSecond: "0.147692" },
        ],
        extraReferenceUsd: "0.036923",
        requiresRatio: true,
    },
    {
        name: "MiniMax-H3-special",
        displayName: "MiniMax H3 限时折扣",
        minSeconds: 4,
        maxSeconds: 15,
        rates: [
            { resolution: 480, upstream: "480p", usdPerSecond: "0.001355" },
            { resolution: 720, upstream: "720p", usdPerSecond: "0.002268" },
        ],
        extraReferenceUsd: "0.000945",
        requiresRatio: true,
        enabled: false,
    },
    ...(["t2v", "i2v", "r2v"] as const).map((kind) => ({
        name: `happyhorse-1.1-${kind}`,
        displayName: `HappyHorse 1.1 ${kind.toUpperCase()}`,
        minSeconds: 4,
        maxSeconds: 15,
        rates: [
            { resolution: 720, upstream: "720p", usdPerSecond: "0.108" },
            { resolution: 1080, upstream: "1080p", usdPerSecond: "0.192" },
        ],
        extraReferenceUsd: "0",
        enabled: false,
    })),
];

export const WHATSTOKEN_TEXT_MODELS: WhatsTokenTextModel[] = [
    { name: "gpt-6-astra-special", displayName: "GPT 6 Astra Special", inputUsdPerM: "1.5", outputUsdPerM: "7.5", cacheReadUsdPerM: "0.15", cacheWriteUsdPerM: "1.875", protocol: "responses", tiers: [
        { maxInputTokens: 272000, inputUsdPerM: "1.5", outputUsdPerM: "7.5", cacheReadUsdPerM: "0.15", cacheWriteUsdPerM: "1.875" },
        { maxInputTokens: 9999000, inputUsdPerM: "3", outputUsdPerM: "11.25", cacheReadUsdPerM: "0.3", cacheWriteUsdPerM: "3.75" },
    ] },
    { name: "gpt-6-astra-azure", displayName: "GPT 6 Astra Azure", inputUsdPerM: "7.8", outputUsdPerM: "39", cacheReadUsdPerM: "0.78", cacheWriteUsdPerM: "9.75", protocol: "responses", tiers: [
        { maxInputTokens: 272000, inputUsdPerM: "7.8", outputUsdPerM: "39", cacheReadUsdPerM: "0.78", cacheWriteUsdPerM: "9.75" },
        { maxInputTokens: 1050000, inputUsdPerM: "15.6", outputUsdPerM: "58.5", cacheReadUsdPerM: "1.56", cacheWriteUsdPerM: "19.5" },
    ] },
    { name: "claude-opus-5-kiro", displayName: "Claude Opus 5 Kiro", inputUsdPerM: "0.5", outputUsdPerM: "2.5", cacheReadUsdPerM: "0.05", cacheWriteUsdPerM: "0.625", protocol: "chat" },
    { name: "claude-opus-5-ccmax", displayName: "Claude Opus 5 CCMax", inputUsdPerM: "1.65", outputUsdPerM: "8.25", cacheReadUsdPerM: "0.165", cacheWriteUsdPerM: "2.0625", protocol: "chat" },
    { name: "claude-fable-5-1-stable", displayName: "Claude Fable 5.1 Stable", inputUsdPerM: "5.9", outputUsdPerM: "29.5", cacheReadUsdPerM: "0.1475", cacheWriteUsdPerM: "7.375", protocol: "chat" },
    { name: "seed-Character-NSFW", displayName: "Seed Character", inputUsdPerM: "0.24", outputUsdPerM: "0.96", cacheReadUsdPerM: "0.048", protocol: "chat", tiers: [
        { maxInputTokens: 32000, inputUsdPerM: "0.24", outputUsdPerM: "0.96", cacheReadUsdPerM: "0.048" },
        { maxInputTokens: 128000, inputUsdPerM: "0.48", outputUsdPerM: "1.92", cacheReadUsdPerM: "0.048" },
    ] },
    { name: "deepseek-v4-1-flash", displayName: "DeepSeek V4.1 Flash", inputUsdPerM: "0.072", outputUsdPerM: "0.288", cacheReadUsdPerM: "0.00144", protocol: "chat", peakHours: true },
    /*
     * Tiered upstream ($0.24/$0.96 up to 32k context): the doubled tier is recorded.
     * Seeded disabled because this model answers the Responses API with an empty body — it only
     * returns content through chat/completions, the same gap that keeps the Claude models out.
     */
    { name: "seed-sc-NSFW", displayName: "Seed SC", inputUsdPerM: "0.48", outputUsdPerM: "1.92", enabled: false },
    { name: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash", inputUsdPerM: "0.184615", outputUsdPerM: "0.369231" },
    { name: "deepseek-v4-flash-ga", displayName: "DeepSeek V4 Flash GA", inputUsdPerM: "0.073846", outputUsdPerM: "0.147692", enabled: false },
    // Tiered upstream ($0.5538/$3.3231 up to 272k): the doubled tier is recorded.
    { name: "gpt-5.6-sol-special", displayName: "GPT-5.6 Sol Special", inputUsdPerM: "1.1077", outputUsdPerM: "4.9846" },
    // Tiered upstream ($2.91/$17.46 up to 272k): the doubled tier is recorded.
    { name: "gpt-5.6-sol-stable", displayName: "GPT-5.6 Sol Stable", inputUsdPerM: "5.82", outputUsdPerM: "26.19" },
];

export const WHATSTOKEN_VIDEO_MODELS: WhatsTokenVideoModel[] = [
    { name: "seedance-2.0-self-developed-NSFW", displayName: "Seedance 2.0 增强版", maxSeconds: 15, rates: [
        { resolution: 720, withVideoUsdPerM: "3.096", withoutVideoUsdPerM: "5.04" },
        { resolution: 1080, withVideoUsdPerM: "3.384", withoutVideoUsdPerM: "5.544" },
        { resolution: 2160, withVideoUsdPerM: "1.728", withoutVideoUsdPerM: "2.88" },
    ] },
    { name: "seedance-2.5-self-developed-NSFW", displayName: "Seedance 2.5 增强版", maxSeconds: 15, rates: [
        { resolution: 720, withVideoUsdPerM: "4.608", withoutVideoUsdPerM: "7.704" },
        { resolution: 1080, withVideoUsdPerM: "5.04", withoutVideoUsdPerM: "8.424" },
    ] },
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

export function usdToSellCny(usd: string, markup = WHATSTOKEN_MARKUP) {
    return toMoneyString(mulMoney(mulMoney(usd, WHATSTOKEN_USD_TO_CNY), markup));
}

export function seedanceEncoderGrid(resolution: number) {
    if (resolution >= 2160) return SEEDANCE_ENCODER[2160];
    if (resolution >= 1080) return SEEDANCE_ENCODER[1080];
    if (resolution >= 720) return SEEDANCE_ENCODER[720];
    return SEEDANCE_ENCODER[480];
}

export function seedanceSpecResolution(spec: string | undefined) {
    const raw = (spec ?? "720").replace(/-video$/i, "").trim();
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 720;
}

/** Tokens billed for one clip. Matches WhatsToken: floor(W×H×(24s+1)/1024). */
export function seedanceTokensFor(resolution: number, seconds: number) {
    const grid = seedanceEncoderGrid(resolution);
    const frames = money(24).times(Math.max(0, seconds)).plus(1);
    return money(grid.width).times(grid.height).times(frames).div(1024).floor();
}

export function seedanceTokensPerSecond(resolution: number) {
    const grid = seedanceEncoderGrid(resolution);
    return money(grid.width).times(grid.height).times(24).div(1024);
}

/** Published $/1M for a WhatsToken Seedance model + spec (`720` / `720-video`). */
export function seedanceUsdPerMillion(modelName: string, spec?: string) {
    const model = WHATSTOKEN_VIDEO_MODELS.find((item) => item.name === modelName);
    if (!model) return undefined;
    const resolution = seedanceSpecResolution(spec);
    const rate = model.rates.find((item) => item.resolution === resolution) ?? model.rates.find((item) => item.resolution === 720) ?? model.rates[0];
    if (!rate) return undefined;
    return (spec ?? "").endsWith("-video") ? rate.withVideoUsdPerM : rate.withoutVideoUsdPerM;
}

/** Sell CNY from actual or estimated tokens: tokens/1M × $/M × 7.2 × 1.3, rounded up. */
export function seedanceSellCnyFromTokens(usdPerMillion: string, tokens: Parameters<typeof money>[0], markup = WHATSTOKEN_MARKUP) {
    const usd = money(tokens).div(1_000_000).times(usdPerMillion);
    return toMoneyString(ceilMoney(mulMoney(mulMoney(usd, WHATSTOKEN_USD_TO_CNY), markup)));
}

/** Freeze amount for N clips of `seconds` using the encoder token formula. */
export function seedanceCatalogSellCny(modelName: string, spec: string | undefined, seconds: number, count = 1, markup = WHATSTOKEN_MARKUP) {
    const usdPerMillion = seedanceUsdPerMillion(modelName, spec);
    if (!usdPerMillion) return undefined;
    const clips = Math.max(1, Math.floor(count));
    const perClip = Math.max(0, seconds);
    const tokens = seedanceTokensFor(seedanceSpecResolution(spec), perClip).times(clips);
    return seedanceSellCnyFromTokens(usdPerMillion, tokens, markup);
}

/** Sell CNY per second from a published $/1M-token rate at the given output height (no extra frame). */
export function seedanceSellCnyPerSecond(usdPerMillion: string, resolution: number, markup = WHATSTOKEN_MARKUP) {
    const usdPerSecond = seedanceTokensPerSecond(resolution).div(1_000_000).times(usdPerMillion);
    return toMoneyString(mulMoney(mulMoney(usdPerSecond, WHATSTOKEN_USD_TO_CNY), markup));
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
    const resolutions = model.rates.map((rate) => String(rate.resolution));
    return parseModelFeatures({
        videoResolutions: [...resolutions.filter((value) => value === "720"), ...resolutions.filter((value) => value !== "720")],
        minSeconds: 4,
        maxSeconds: model.maxSeconds,
        aspectPresets: defaultVideoAspectPresets(),
    });
}

function imageSellCny(model: WhatsTokenImageModel, spec: string, markup: string) {
    const direct = model.sizesCny?.[spec];
    if (direct) return toMoneyString(direct);
    return usdToSellCny(model.sizes[spec] ?? "0", markup);
}

export function whatsTokenImagePriceRows(model: WhatsTokenImageModel, markup = WHATSTOKEN_MARKUP): WhatsTokenSeedPriceRow[] {
    const extra = usdToSellCny(model.extraReferenceUsd, markup);
    const specs = Object.keys(model.sizesCny ?? model.sizes);
    const defaultSpec = specs.includes(model.defaultSize) ? model.defaultSize : (specs[0] ?? model.defaultSize);
    return [
        { spec: null, unitPrice: imageSellCny(model, defaultSpec, markup), extraReferencePrice: extra, billingMode: "per_image" },
        ...specs.map((spec) => ({
            spec,
            unitPrice: imageSellCny(model, spec, markup),
            extraReferencePrice: extra,
            billingMode: "per_image" as const,
        })),
    ];
}

export function whatsTokenDurationVideoFeatures(model: WhatsTokenDurationVideoModel): ModelFeatures {
    return parseModelFeatures({
        videoResolutions: model.rates.map((rate) => String(rate.resolution)),
        minSeconds: model.minSeconds,
        maxSeconds: model.maxSeconds,
        aspectPresets: defaultVideoAspectPresets(),
    });
}

/**
 * Both the plain and the `-video` spec are emitted at the same rate: duration pricing does not
 * distinguish a video reference, but the estimator still asks for `720-video` whenever one is
 * attached, and a missing row would silently fall back to the default resolution's price.
 */
export function whatsTokenDurationVideoPriceRows(model: WhatsTokenDurationVideoModel, markup = WHATSTOKEN_MARKUP): WhatsTokenSeedPriceRow[] {
    const extra = usdToSellCny(model.extraReferenceUsd, markup);
    const defaultRate = model.rates[0];
    const rows: WhatsTokenSeedPriceRow[] = [
        { spec: null, unitPrice: usdToSellCny(defaultRate.usdPerSecond, markup), extraReferencePrice: extra, billingMode: "per_second" },
    ];
    for (const rate of model.rates) {
        const unitPrice = usdToSellCny(rate.usdPerSecond, markup);
        rows.push({ spec: String(rate.resolution), unitPrice, extraReferencePrice: extra, billingMode: "per_second" });
        rows.push({ spec: `${rate.resolution}${VIDEO_INPUT_SPEC_SUFFIX}`, unitPrice, extraReferencePrice: extra, billingMode: "per_second" });
    }
    return rows;
}

export function whatsTokenTextPriceRows(model: WhatsTokenTextModel, markup = WHATSTOKEN_MARKUP): WhatsTokenSeedPriceRow[] {
    const rows: WhatsTokenSeedPriceRow[] = [];
    const add = (spec: string | null, usd: string) => rows.push({ spec, unitPrice: usdToSellCny(usd, markup), extraReferencePrice: "0.000000", billingMode: "per_token" });
    add(null, model.inputUsdPerM);
    const buckets = (rate: Pick<WhatsTokenTextModel, "inputUsdPerM" | "outputUsdPerM" | "cacheReadUsdPerM" | "cacheWriteUsdPerM">, suffix = "") => {
        add(`input${suffix}`, rate.inputUsdPerM); add(`output${suffix}`, rate.outputUsdPerM);
        if (rate.cacheReadUsdPerM !== undefined) add(`cache_read${suffix}`, rate.cacheReadUsdPerM);
        if (rate.cacheWriteUsdPerM !== undefined) add(`cache_write${suffix}`, rate.cacheWriteUsdPerM);
    };
    buckets(model);
    for (const tier of model.tiers ?? []) buckets(tier, `:${tier.maxInputTokens}`);
    return rows;
}

/** Upstream resolution string for a duration-priced model, e.g. 1440 → `2k`. */
export function whatsTokenDurationVideoResolution(modelName: string, resolution: string | undefined) {
    const model = WHATSTOKEN_DURATION_VIDEO_MODELS.find((item) => item.name === modelName);
    if (!model) return undefined;
    const wanted = normalizeVideoPricingResolution(resolution);
    const rate = model.rates.find((item) => String(item.resolution) === wanted) ?? model.rates[0];
    return rate.upstream;
}

export function isWhatsTokenDurationVideoModel(modelName: string) {
    return WHATSTOKEN_DURATION_VIDEO_MODELS.some((item) => item.name === modelName);
}

export function whatsTokenDurationVideoRequiresRatio(modelName: string) {
    return WHATSTOKEN_DURATION_VIDEO_MODELS.find((item) => item.name === modelName)?.requiresRatio === true;
}

export function whatsTokenVideoPriceRows(model: WhatsTokenVideoModel, markup = WHATSTOKEN_MARKUP): WhatsTokenSeedPriceRow[] {
    const defaultRate = model.rates.find((rate) => rate.resolution === 720) ?? model.rates[0];
    const rows: WhatsTokenSeedPriceRow[] = [
        {
            spec: null,
            unitPrice: seedanceSellCnyPerSecond(defaultRate.withoutVideoUsdPerM, defaultRate.resolution, markup),
            extraReferencePrice: usdToSellCny("0", markup),
            billingMode: "per_second",
        },
    ];
    for (const rate of model.rates) {
        rows.push({ spec: `tokens:${rate.resolution}`, unitPrice: usdToSellCny(rate.withoutVideoUsdPerM, markup), extraReferencePrice: "0.000000", billingMode: "per_second" });
        rows.push({ spec: `tokens:${rate.resolution}-video`, unitPrice: usdToSellCny(rate.withVideoUsdPerM, markup), extraReferencePrice: "0.000000", billingMode: "per_second" });
        rows.push({
            spec: String(rate.resolution),
            unitPrice: seedanceSellCnyPerSecond(rate.withoutVideoUsdPerM, rate.resolution, markup),
            extraReferencePrice: usdToSellCny("0", markup),
            billingMode: "per_second",
        });
        rows.push({
            spec: `${rate.resolution}-video`,
            unitPrice: seedanceSellCnyPerSecond(rate.withVideoUsdPerM, rate.resolution, markup),
            extraReferencePrice: usdToSellCny("0", markup),
            billingMode: "per_second",
        });
    }
    return rows;
}

/** Match the actual provider host; a channel name alone is not sufficient authorization. */
export function isWhatsTokenChannel(channel: { baseUrl: string; apiFormat?: string }) {
    try { return ["www.whatstoken.ai", "whatstoken.ai"].includes(new URL(channel.baseUrl).hostname.toLowerCase()) && (!channel.apiFormat || channel.apiFormat === "openai"); }
    catch { return false; }
}

export const WHATSTOKEN_ADDED_MODEL_NAMES = new Set([
    "gpt-6-astra-special", "gpt-6-astra-azure", "claude-opus-5-kiro", "claude-opus-5-ccmax", "claude-fable-5-1-stable", "seed-Character-NSFW", "deepseek-v4-1-flash",
    "seedance-2.0-self-developed-NSFW", "seedance-2.5-self-developed-NSFW",
    "dola-seedream-5-0-pro", "seedream-5-0-pro", "seedream-5-0-spg", "seedream-5.0-lite",
]);

export function whatsTokenImagePixelSpec(modelName: string, size: string | undefined) {
    if (!["dola-seedream-5-0-pro", "seedream-5-0-pro"].includes(modelName)) return undefined;
    const dimensions = /^(\d+)x(\d+)$/i.exec(size ?? "");
    if (!dimensions) return undefined;
    return Number(dimensions[1]) * Number(dimensions[2]) <= 2_360_000 ? "1K" : "2K";
}
