import { badRequest } from "../../common/errors";
import { defaultAspectPresets, isAspectRatioLabel, parseAspectPresets, type AspectPreset } from "./aspect-presets";

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

export type ModelFeaturesInput = Partial<{
    resolutions: string[];
    maxCount: number;
    supportsTransparent: boolean;
    aspectRatios: string[];
    aspectPresets: AspectPreset[];
    videoResolutions: string[];
    maxSeconds: number;
}>;

const RESOLUTION_SET = new Set<string>(IMAGE_RESOLUTIONS);

export function parseModelFeatures(raw: unknown): ModelFeatures {
    const value = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as ModelFeaturesInput) : {};
    const aspectPresets = parseAspectPresets(value.aspectPresets, value.aspectRatios);
    return {
        resolutions: pickList(value.resolutions, RESOLUTION_SET, [...IMAGE_RESOLUTIONS]) as ImageResolution[],
        maxCount: clampInt(value.maxCount, 1, DEFAULT_MAX_COUNT, DEFAULT_MAX_COUNT),
        supportsTransparent: Boolean(value.supportsTransparent),
        aspectPresets,
        aspectRatios: aspectPresets.map((item) => item.ratio),
        videoResolutions: normalizeVideoResolutions(value.videoResolutions),
        maxSeconds: clampInt(value.maxSeconds, 1, 600, DEFAULT_MAX_SECONDS),
    };
}

/** Maps stored quality aliases onto the 1K/2K/4K UI tiers. */
export function normalizeImageResolution(quality: string | undefined): ImageResolution | "auto" {
    const value = (quality ?? "").trim().toLowerCase();
    if (!value || value === "auto") return "auto";
    if (value === "high" || value === "4k") return "4K";
    if (value === "medium" || value === "hd" || value === "2k") return "2K";
    if (value === "low" || value === "standard" || value === "1k") return "1K";
    return "auto";
}

export function assertImageGenerationFeatures(
    features: ModelFeatures,
    input: { count?: number; quality?: string; size?: string; background?: string },
) {
    const count = Math.floor(input.count ?? 1);
    if (count > features.maxCount) throw badRequest("COUNT_LIMIT", `该模型每次最多生成 ${features.maxCount} 张`);
    if ((input.background ?? "").trim().toLowerCase() === "transparent" && !features.supportsTransparent) {
        throw badRequest("TRANSPARENT_UNSUPPORTED", "该模型不支持透明背景");
    }

    const resolution = normalizeImageResolution(input.quality);
    if (resolution !== "auto" && !features.resolutions.includes(resolution)) {
        throw badRequest("RESOLUTION_UNSUPPORTED", "该模型不支持所选分辨率");
    }

    const size = (input.size ?? "").trim();
    if (!size || size.toLowerCase() === "auto") return;
    if (/^\d+\s*[x×*]\s*\d+$/i.test(size)) return;
    if (size.includes(":") && !features.aspectRatios.includes(size)) {
        throw badRequest("ASPECT_UNSUPPORTED", "该模型不支持所选宽高比");
    }
}

export function assertVideoGenerationFeatures(features: ModelFeatures, input: { seconds?: number; resolution?: string; size?: string }) {
    const seconds = Math.floor(input.seconds ?? 0);
    if (seconds > features.maxSeconds) throw badRequest("SECONDS_LIMIT", `该模型最长 ${features.maxSeconds} 秒`);
    const resolution = (input.resolution ?? "").trim().replace(/p$/i, "");
    if (resolution && features.videoResolutions.length && !features.videoResolutions.includes(resolution)) {
        throw badRequest("RESOLUTION_UNSUPPORTED", "该模型不支持所选清晰度");
    }
    const size = (input.size ?? "").trim();
    if (!size || size.toLowerCase() === "auto") return;
    if (/^\d+\s*[x×*]\s*\d+$/i.test(size)) return;
    if (isAspectRatioLabel(size) && features.aspectRatios.length && !features.aspectRatios.includes(size)) {
        throw badRequest("ASPECT_UNSUPPORTED", "该模型不支持所选宽高比");
    }
}

function pickList(values: string[] | undefined, allowed: Set<string>, fallback: string[]) {
    if (!Array.isArray(values) || !values.length) return fallback;
    const next = [...new Set(values.map((item) => String(item).trim()).filter((item) => allowed.has(item)))];
    return next.length ? next : fallback;
}

function normalizeVideoResolutions(values: string[] | undefined) {
    if (!Array.isArray(values) || !values.length) return [...DEFAULT_VIDEO_RESOLUTIONS];
    const next = [...new Set(values.map((item) => String(item).trim().replace(/p$/i, "")).filter((item) => /^\d+$/.test(item)))];
    return next.length ? next : [...DEFAULT_VIDEO_RESOLUTIONS];
}

export function isEmptyFeatures(raw: unknown) {
    return !raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw as object).length === 0;
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}
