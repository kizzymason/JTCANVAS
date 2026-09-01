export const IMAGE_RESOLUTION_TIERS = ["1K", "2K", "4K"] as const;
export type ImageResolutionTier = (typeof IMAGE_RESOLUTION_TIERS)[number];

export type AspectPreset = {
    ratio: string;
    label: string;
    sizes: Partial<Record<ImageResolutionTier, string>>;
};

type SizeTriple = Record<ImageResolutionTier, readonly [number, number]>;

/**
 * Seedream 5.0 Pro native pixels (BytePlus / Volcengine Method 1). 2K is not a linear 2× of 1K
 * (4:3 1K 1152x864 → 2K 2368x1776, not 2304x1728). 4K follows Seedream 5 Lite's 4K table.
 * Extra 2:1 / 3:1 family sizes stay 16-aligned for models that accept custom WxH.
 */
export const DEFAULT_ASPECT_SIZES: Record<string, SizeTriple> = {
    "1:1": { "1K": [1024, 1024], "2K": [2048, 2048], "4K": [4096, 4096] },
    "16:9": { "1K": [1424, 800], "2K": [2816, 1584], "4K": [5504, 3040] },
    "9:16": { "1K": [800, 1424], "2K": [1584, 2816], "4K": [3040, 5504] },
    "4:3": { "1K": [1152, 864], "2K": [2368, 1776], "4K": [4704, 3520] },
    "3:4": { "1K": [864, 1152], "2K": [1776, 2368], "4K": [3520, 4704] },
    "3:2": { "1K": [1248, 832], "2K": [2496, 1664], "4K": [4992, 3328] },
    "2:3": { "1K": [832, 1248], "2K": [1664, 2496], "4K": [3328, 4992] },
    "4:5": { "1K": [896, 1120], "2K": [1792, 2240], "4K": [3584, 4480] },
    "5:4": { "1K": [1120, 896], "2K": [2240, 1792], "4K": [4480, 3584] },
    "21:9": { "1K": [1568, 672], "2K": [3136, 1344], "4K": [6240, 2656] },
    "9:21": { "1K": [672, 1568], "2K": [1344, 3136], "4K": [2656, 6240] },
    "2:1": { "1K": [1440, 720], "2K": [2880, 1440], "4K": [5760, 2880] },
    "1:2": { "1K": [720, 1440], "2K": [1440, 2880], "4K": [2880, 5760] },
    "3:1": { "1K": [1680, 560], "2K": [3360, 1120], "4K": [6720, 2240] },
    "1:3": { "1K": [560, 1680], "2K": [1120, 3360], "4K": [2240, 6720] },
};

export const DEFAULT_ASPECT_1K: Record<string, readonly [number, number]> = Object.fromEntries(
    Object.entries(DEFAULT_ASPECT_SIZES).map(([ratio, sizes]) => [ratio, sizes["1K"]]),
);

export const DEFAULT_ASPECT_RATIO_ORDER = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9", "9:21", "2:1", "1:2", "3:1", "1:3"] as const;

/**
 * PiAPI Pro encodes ratio into upstream pixels. Documented 16:9 is 1312x736 at 1K and 2560x1440 at 2K
 * (1312×2 is 2624, not 2560). Other ratios fall back to the ByteDance Pro table.
 */
export const PIAPI_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9"] as const;
export const PIAPI_PRO_ASPECT_OVERRIDES: Record<string, Partial<Record<ImageResolutionTier, readonly [number, number]>>> = {
    "16:9": { "1K": [1312, 736], "2K": [2560, 1440] },
    "9:16": { "1K": [736, 1312], "2K": [1440, 2560] },
};

/** Seedream 5 Lite 2K + 3K (shown as 4K in our UI because PiAPI Lite has no 4K). */
const PIAPI_LITE_ASPECT_SIZES: Record<string, SizeTriple> = {
    "1:1": { "1K": [1024, 1024], "2K": [2048, 2048], "4K": [3072, 3072] },
    "16:9": { "1K": [1424, 800], "2K": [2848, 1600], "4K": [4096, 2304] },
    "9:16": { "1K": [800, 1424], "2K": [1600, 2848], "4K": [2304, 4096] },
    "4:3": { "1K": [1152, 864], "2K": [2304, 1728], "4K": [3456, 2592] },
    "3:4": { "1K": [864, 1152], "2K": [1728, 2304], "4K": [2592, 3456] },
    "3:2": { "1K": [1248, 832], "2K": [2496, 1664], "4K": [3744, 2496] },
    "2:3": { "1K": [832, 1248], "2K": [1664, 2496], "4K": [2496, 3744] },
    "4:5": { "1K": [896, 1120], "2K": [1832, 2288], "4K": [2752, 3440] },
    "5:4": { "1K": [1120, 896], "2K": [2288, 1832], "4K": [3440, 2752] },
    "21:9": { "1K": [1568, 672], "2K": [3136, 1344], "4K": [4704, 2016] },
};

export const DEFAULT_VIDEO_ASPECT_RATIO_ORDER = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"] as const;
const VIDEO_ASPECT_SIZES: Record<string, SizeTriple> = {
    "1:1": { "1K": [1024, 1024], "2K": [2048, 2048], "4K": [4096, 4096] },
    "16:9": { "1K": [1280, 720], "2K": [2560, 1440], "4K": [3840, 2160] },
    "9:16": { "1K": [720, 1280], "2K": [1440, 2560], "4K": [2160, 3840] },
    "4:3": { "1K": [960, 720], "2K": [1920, 1440], "4K": [3840, 2880] },
    "3:4": { "1K": [720, 960], "2K": [1440, 1920], "4K": [2880, 3840] },
    "3:2": { "1K": [1080, 720], "2K": [2160, 1440], "4K": [4320, 2880] },
    "2:3": { "1K": [720, 1080], "2K": [1440, 2160], "4K": [2880, 4320] },
    "21:9": { "1K": [1680, 720], "2K": [3360, 1440], "4K": [5040, 2160] },
};

const MAX_PRESETS = 40;

export function parsePixelSize(value: string) {
    const match = value.trim().match(/^(\d+)\s*[x×*]\s*(\d+)$/i);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
    return { width, height };
}

export function formatPixelSize(width: number, height: number) {
    return `${width}x${height}`;
}

export function isAspectRatioLabel(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (trimmed.toLowerCase() === "auto") return true;
    return /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(trimmed);
}

export function defaultSizesForRatio(ratio: string): Partial<Record<ImageResolutionTier, string>> {
    const sizes = DEFAULT_ASPECT_SIZES[ratio];
    if (!sizes) return {};
    return {
        "1K": formatPixelSize(sizes["1K"][0], sizes["1K"][1]),
        "2K": formatPixelSize(sizes["2K"][0], sizes["2K"][1]),
        "4K": formatPixelSize(sizes["4K"][0], sizes["4K"][1]),
    };
}

export function defaultAspectPresets(): AspectPreset[] {
    return [
        ...DEFAULT_ASPECT_RATIO_ORDER.map((ratio) => ({
            ratio,
            label: ratio,
            sizes: defaultSizesForRatio(ratio),
        })),
        { ratio: "auto", label: "auto", sizes: {} },
    ];
}

export function piapiAspectPresets(kind: "pro" | "lite" = "pro"): AspectPreset[] {
    if (kind === "lite") return presetsFromSizeTable(PIAPI_ASPECT_RATIOS, PIAPI_LITE_ASPECT_SIZES);
    return presetsFromSizeTable(PIAPI_ASPECT_RATIOS, DEFAULT_ASPECT_SIZES, PIAPI_PRO_ASPECT_OVERRIDES);
}

export function defaultVideoAspectPresets(): AspectPreset[] {
    return presetsFromSizeTable(DEFAULT_VIDEO_ASPECT_RATIO_ORDER, VIDEO_ASPECT_SIZES);
}

export function scalePixelSize(value: string, multiplier: number) {
    const parsed = parsePixelSize(value);
    if (!parsed) return value;
    return formatPixelSize(parsed.width * multiplier, parsed.height * multiplier);
}

/**
 * Seedream 5.0 Pro bills by pixel budget, not longest edge: ≤2.36MP is the 1K rate.
 * 2K tops out around 4.6MP. Lite 3K/4K (shown as 4K here) sit well above 6MP.
 * Longest-edge 1280/2560 would mis-price 1K 16:9 (1424) as 2K and 2K 16:9 (2816) as 4K.
 */
const TIER_1K_MAX_PIXELS = 2_360_000;
const TIER_2K_MAX_PIXELS = 6_000_000;

export function qualityToResolutionTier(quality: string | undefined): ImageResolutionTier | undefined {
    const value = (quality ?? "").trim().toLowerCase();
    if (value === "high" || value === "4k") return "4K";
    if (value === "medium" || value === "hd" || value === "2k") return "2K";
    if (value === "low" || value === "standard" || value === "1k") return "1K";
    return undefined;
}

/** Map a pixel size onto 1K/2K/4K by matching native presets first, then Seedream area bands. */
export function tierFromPixelSize(width: number, height: number, presets: AspectPreset[] = defaultAspectPresets()): ImageResolutionTier {
    const catalogs = [...presets, ...defaultAspectPresets(), ...piapiAspectPresets("pro"), ...piapiAspectPresets("lite"), ...defaultVideoAspectPresets()];
    const seen = new Set<string>();
    for (const preset of catalogs) {
        if (preset.ratio.toLowerCase() === "auto") continue;
        const sizes = completePresetSizes(preset.sizes, preset.ratio);
        for (const tier of IMAGE_RESOLUTION_TIERS) {
            const parsed = parsePixelSize(sizes[tier] ?? "");
            if (!parsed) continue;
            const key = `${tier}:${parsed.width}x${parsed.height}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (parsed.width === width && parsed.height === height) return tier;
        }
    }
    const pixels = width * height;
    if (pixels <= TIER_1K_MAX_PIXELS) return "1K";
    if (pixels <= TIER_2K_MAX_PIXELS) return "2K";
    return "4K";
}

/** Fill missing tiers from the native ratio table. Only unknown custom 1K rows fall back to ×2/×4. */
export function completePresetSizes(sizes: Partial<Record<ImageResolutionTier, string>>, ratio?: string) {
    const next: Partial<Record<ImageResolutionTier, string>> = { ...sizes };
    const catalog = ratio && ratio.toLowerCase() !== "auto" ? catalogSizesForRatio(ratio, next) : {};
    for (const tier of IMAGE_RESOLUTION_TIERS) {
        if (!next[tier] && catalog[tier]) next[tier] = catalog[tier]!;
    }
    const base = next["1K"];
    if (base) {
        if (!next["2K"]) next["2K"] = scalePixelSize(base, 2);
        if (!next["4K"]) next["4K"] = scalePixelSize(base, 4);
    }
    return next;
}

export function presetSizeForQuality(preset: AspectPreset, quality: string | undefined) {
    if (preset.ratio.toLowerCase() === "auto") return undefined;
    const sizes = completePresetSizes(preset.sizes, preset.ratio);
    const tier = qualityToResolutionTier(quality) ?? "1K";
    return sizes[tier] || sizes["1K"];
}

function catalogSizesForRatio(ratio: string, existing: Partial<Record<ImageResolutionTier, string>>): Partial<Record<ImageResolutionTier, string>> {
    const fromDefault = defaultSizesForRatio(ratio);
    const over = PIAPI_PRO_ASPECT_OVERRIDES[ratio];
    const existing1K = existing["1K"];
    if (existing1K && over?.["1K"] && existing1K === formatPixelSize(over["1K"][0], over["1K"][1])) {
        return {
            ...fromDefault,
            "1K": existing1K,
            ...(over["2K"] ? { "2K": formatPixelSize(over["2K"][0], over["2K"][1]) } : {}),
        };
    }
    const lite = PIAPI_LITE_ASPECT_SIZES[ratio];
    if (existing["2K"] && lite) {
        const lite2K = formatPixelSize(lite["2K"][0], lite["2K"][1]);
        if (existing["2K"] === lite2K) {
            return {
                "1K": formatPixelSize(lite["1K"][0], lite["1K"][1]),
                "2K": lite2K,
                "4K": formatPixelSize(lite["4K"][0], lite["4K"][1]),
            };
        }
    }
    return fromDefault;
}

/**
 * `aspectPresets` is the admin-edited list. A stored `aspectRatios` string array (old models)
 * is expanded onto the default 1K/2K/4K table without adding extra ratios.
 */
export function parseAspectPresets(presets: unknown, ratioLabels: unknown): AspectPreset[] {
    if (Array.isArray(presets) && presets.length) return normalizePresetList(presets);
    if (Array.isArray(ratioLabels) && ratioLabels.length) return presetsFromRatioLabels(ratioLabels);
    return defaultAspectPresets();
}

function presetsFromSizeTable(
    order: readonly string[],
    table: Record<string, SizeTriple>,
    overrides: Record<string, Partial<Record<ImageResolutionTier, readonly [number, number]>>> = {},
): AspectPreset[] {
    return [
        ...order.map((ratio) => {
            const base = table[ratio] ?? DEFAULT_ASPECT_SIZES[ratio];
            const over = overrides[ratio] ?? {};
            const sizes: Partial<Record<ImageResolutionTier, string>> = {};
            for (const tier of IMAGE_RESOLUTION_TIERS) {
                const pair = over[tier] ?? base?.[tier];
                if (pair) sizes[tier] = formatPixelSize(pair[0], pair[1]);
            }
            return { ratio, label: ratio, sizes };
        }),
        { ratio: "auto", label: "auto", sizes: {} },
    ];
}

function presetsFromRatioLabels(labels: unknown[]) {
    const seen = new Set<string>();
    const presets: AspectPreset[] = [];
    for (const raw of labels) {
        const ratio = String(raw ?? "").trim();
        if (!isAspectRatioLabel(ratio) || seen.has(ratio)) continue;
        seen.add(ratio);
        presets.push({
            ratio,
            label: ratio,
            sizes: ratio.toLowerCase() === "auto" ? {} : defaultSizesForRatio(ratio),
        });
    }
    return presets.length ? presets.slice(0, MAX_PRESETS) : defaultAspectPresets();
}

function normalizePresetList(items: unknown[]) {
    const seen = new Set<string>();
    const presets: AspectPreset[] = [];
    for (const item of items) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const row = item as { ratio?: unknown; label?: unknown; sizes?: unknown };
        const ratio = String(row.ratio ?? "").trim();
        if (!isAspectRatioLabel(ratio) || seen.has(ratio)) continue;
        seen.add(ratio);
        const sizes = parseSizeMap(row.sizes);
        presets.push({
            ratio,
            label: String(row.label ?? ratio).trim().slice(0, 32) || ratio,
            sizes: ratio.toLowerCase() === "auto" ? {} : completePresetSizes(sizes, ratio),
        });
        if (presets.length >= MAX_PRESETS) break;
    }
    return presets.length ? presets : defaultAspectPresets();
}

function parseSizeMap(value: unknown): Partial<Record<ImageResolutionTier, string>> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const record = value as Record<string, unknown>;
    const sizes: Partial<Record<ImageResolutionTier, string>> = {};
    for (const tier of IMAGE_RESOLUTION_TIERS) {
        const parsed = typeof record[tier] === "string" ? parsePixelSize(record[tier]) : null;
        if (parsed) sizes[tier] = formatPixelSize(parsed.width, parsed.height);
    }
    return sizes;
}
