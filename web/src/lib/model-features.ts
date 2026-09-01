import type { PublicModel } from "@/services/api/models";
import { defaultAspectPresets, parseAspectPresets, type AspectPreset } from "@/lib/aspect-presets";

export const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];

export const IMAGE_ASPECT_RATIOS = defaultAspectPresets().map((item) => item.ratio);
export const DEFAULT_MAX_COUNT = 15;
export const DEFAULT_VIDEO_RESOLUTIONS = ["480", "720"];
export const DEFAULT_MAX_SECONDS = 20;

export type ModelFeatures = {
    resolutions: ImageResolution[];
    maxCount: number;
    supportsTransparent: boolean;
    aspectRatios: string[];
    aspectPresets: AspectPreset[];
    videoResolutions: string[];
    maxSeconds: number;
};

export const DEFAULT_MODEL_FEATURES: ModelFeatures = {
    resolutions: [...IMAGE_RESOLUTIONS],
    maxCount: DEFAULT_MAX_COUNT,
    supportsTransparent: false,
    aspectPresets: defaultAspectPresets(),
    aspectRatios: IMAGE_ASPECT_RATIOS,
    videoResolutions: [...DEFAULT_VIDEO_RESOLUTIONS],
    maxSeconds: DEFAULT_MAX_SECONDS,
};

export function modelFeaturesOf(model: PublicModel | undefined): ModelFeatures {
    const raw = model?.features;
    if (!raw) return DEFAULT_MODEL_FEATURES;
    const aspectPresets = parseAspectPresets(raw.aspectPresets, raw.aspectRatios);
    return {
        resolutions: pickResolutions(raw.resolutions),
        maxCount: clampInt(raw.maxCount, 1, DEFAULT_MAX_COUNT, DEFAULT_MAX_COUNT),
        supportsTransparent: Boolean(raw.supportsTransparent),
        aspectPresets,
        aspectRatios: aspectPresets.map((item) => item.ratio),
        videoResolutions: pickVideoResolutions(raw.videoResolutions),
        maxSeconds: clampInt(raw.maxSeconds, 1, 600, DEFAULT_MAX_SECONDS),
    };
}

/** Maps stored quality aliases onto the 1K / 2K / 4K UI tiers. */
export function normalizeImageResolution(quality: string | undefined): ImageResolution | "auto" {
    const value = (quality ?? "").trim().toLowerCase();
    if (!value || value === "auto") return "auto";
    if (value === "high" || value === "4k") return "4K";
    if (value === "medium" || value === "hd" || value === "2k") return "2K";
    if (value === "low" || value === "standard" || value === "1k") return "1K";
    return "auto";
}

/** Old aspect buttons encoded 2K/4K into the size value; split those back out. */
export function migrateLegacyImageSize(size: string): { size: string; qualityHint?: ImageResolution } {
    const value = (size ?? "").trim();
    const tagged = value.match(/^(\d+:\d+|auto)-(2k|4k)$/i);
    if (tagged) return { size: tagged[1], qualityHint: tagged[2].toLowerCase() === "4k" ? "4K" : "2K" };
    return { size: value || "auto" };
}

function pickResolutions(values: string[] | undefined): ImageResolution[] {
    const next = (values ?? []).filter((item): item is ImageResolution => IMAGE_RESOLUTIONS.includes(item as ImageResolution));
    return next.length ? [...new Set(next)] : [...IMAGE_RESOLUTIONS];
}

function pickVideoResolutions(values: string[] | undefined) {
    const next = [...new Set((values ?? []).map((item) => String(item).trim().replace(/p$/i, "")).filter((item) => /^\d+$/.test(item)))];
    return next.length ? next : [...DEFAULT_VIDEO_RESOLUTIONS];
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}
