export const IMAGE_RESOLUTION_TIERS = ["1K", "2K", "4K"] as const;
export type ImageResolutionTier = (typeof IMAGE_RESOLUTION_TIERS)[number];

export type AspectPreset = {
    ratio: string;
    label: string;
    sizes: Partial<Record<ImageResolutionTier, string>>;
};

/** 1K pixel sizes. 2K/4K default to exact 2× / 4× unless an admin overrides a tier. */
export const DEFAULT_ASPECT_1K: Record<string, readonly [number, number]> = {
    "1:1": [1024, 1024],
    "16:9": [1280, 720],
    "9:16": [720, 1280],
    "4:3": [1152, 864],
    "3:4": [864, 1152],
    "3:2": [1200, 800],
    "2:3": [800, 1200],
    "2:1": [1376, 688],
    "1:2": [688, 1376],
    "21:9": [1568, 672],
    "3:1": [1680, 560],
    "1:3": [560, 1680],
};

export const DEFAULT_ASPECT_RATIO_ORDER = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "21:9", "3:1", "1:3"] as const;

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
    const base = DEFAULT_ASPECT_1K[ratio];
    if (!base) return {};
    const [width, height] = base;
    return {
        "1K": formatPixelSize(width, height),
        "2K": formatPixelSize(width * 2, height * 2),
        "4K": formatPixelSize(width * 4, height * 4),
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

export function scalePixelSize(value: string, multiplier: number) {
    const parsed = parsePixelSize(value);
    if (!parsed) return value;
    return formatPixelSize(parsed.width * multiplier, parsed.height * multiplier);
}

export function completePresetSizes(sizes: Partial<Record<ImageResolutionTier, string>>) {
    const next: Partial<Record<ImageResolutionTier, string>> = { ...sizes };
    const base = next["1K"];
    if (base) {
        if (!next["2K"]) next["2K"] = scalePixelSize(base, 2);
        if (!next["4K"]) next["4K"] = scalePixelSize(base, 4);
    }
    return next;
}

export function presetSizeForQuality(preset: AspectPreset, quality: string | undefined) {
    if (preset.ratio.toLowerCase() === "auto") return undefined;
    const sizes = completePresetSizes(preset.sizes);
    const value = (quality ?? "").trim().toLowerCase();
    const tier: ImageResolutionTier = value === "high" || value === "4k" ? "4K" : value === "medium" || value === "hd" || value === "2k" ? "2K" : value === "low" || value === "standard" || value === "1k" ? "1K" : "1K";
    return sizes[tier] || sizes["1K"];
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
            sizes: ratio.toLowerCase() === "auto" ? {} : completePresetSizes(sizes),
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
