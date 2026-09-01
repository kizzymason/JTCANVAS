import { badRequest } from "../../common/errors";
import { defaultAspectPresets, parsePixelSize, presetSizeForQuality, tierFromPixelSize, type AspectPreset } from "../pricing/aspect-presets";

/**
 * Fallback sizing when a request uses a ratio the model has not given an explicit pixel table for.
 * Preset 1K/2K/4K sizes from the model (or the site defaults) take precedence.
 */
const QUALITY_BASE: Record<string, number> = { low: 1024, medium: 2048, high: 2880, standard: 1024, hd: 2048 };
const QUALITY_ALIASES: Record<string, string> = { "1k": "low", "2k": "medium", "4k": "high" };
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 32_000_000;
const IMAGE_MAX_EDGE = 8192;
const IMAGE_MAX_RATIO = 4;

const GEMINI_SUPPORTED_RATIOS = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];
const GEMINI_IMAGE_SIZE_BY_QUALITY: Record<string, string> = { low: "1K", medium: "2K", high: "4K", standard: "1K", hd: "2K" };

export function normalizeQuality(quality: string | undefined) {
    const value = (quality ?? "").trim().toLowerCase();
    const normalized = QUALITY_ALIASES[value] || value;
    return QUALITY_BASE[normalized] ? normalized : undefined;
}

/** Only "transparent" is forwarded; anything else keeps the provider default opaque background. */
export function normalizeBackground(background: string | undefined) {
    return background?.trim().toLowerCase() === "transparent" ? "transparent" : undefined;
}

export function parseRatioValue(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw badRequest("INVALID_IMAGE_SIZE", "图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    const width = Number(parts[0]);
    const height = Number(parts[1]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw badRequest("INVALID_IMAGE_RATIO", "图像比例必须是正数，例如 9:16");
    return { width, height };
}

function parseImageRatio(value: string) {
    const ratio = parseRatioValue(value);
    if (Math.max(ratio.width, ratio.height) / Math.min(ratio.width, ratio.height) > IMAGE_MAX_RATIO) throw badRequest("IMAGE_RATIO_LIMIT", "图像宽高比不能超过 4:1，请调整尺寸");
    return ratio;
}

export function parseImageDimensions(value: string) {
    return parsePixelSize(value);
}

export function validateImageSize(width: number, height: number, options?: { fromPreset?: boolean }) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw badRequest("INVALID_IMAGE_DIMENSIONS", "图像尺寸必须是正整数，例如 1024x1024");
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw badRequest("IMAGE_EDGE_LIMIT", "图像尺寸最长边不能超过 8192px，请调整尺寸");
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw badRequest("IMAGE_RATIO_LIMIT", "图像宽高比不能超过 4:1，请调整尺寸");
    if (options?.fromPreset) return;
    if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) throw badRequest("IMAGE_DIMENSION_STEP", "图像尺寸的宽高必须是 16 的倍数，请调整尺寸");
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw badRequest("IMAGE_PIXEL_LIMIT", "图像总像素需在 655360 到 32000000 之间，请调整尺寸");
}

/** Maps "quality + ratio" onto an explicit pixel dimension like "3840x2160". */
function resolveSizeFromRatio(quality: string | undefined, ratio: string) {
    const parsed = parseImageRatio(ratio);
    const basePixels = quality ? QUALITY_BASE[quality] : undefined;
    const isLandscape = parsed.width >= parsed.height;
    const longRatio = isLandscape ? parsed.width / parsed.height : parsed.height / parsed.width;

    let longSide: number;
    let shortSide: number;
    if (basePixels) {
        const longSideRaw = Math.sqrt(basePixels * basePixels * longRatio);
        longSide = Math.floor(longSideRaw / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
        shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    } else {
        shortSide = DEFAULT_IMAGE_SHORT_SIDE;
        longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    }

    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    validateImageSize(width, height);
    return `${width}x${height}`;
}

/** Undefined means "let the provider decide". */
export function resolveRequestSize(quality: string | undefined, size: string | undefined, presets: AspectPreset[] = defaultAspectPresets()) {
    const value = (size ?? "").trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateImageSize(dimensions.width, dimensions.height);
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (value.includes(":")) {
        const preset = presets.find((item) => item.ratio === value);
        const pixels = preset ? presetSizeForQuality(preset, quality) : undefined;
        if (pixels) {
            const parsed = parseImageDimensions(pixels);
            if (parsed) {
                validateImageSize(parsed.width, parsed.height, { fromPreset: true });
                return pixels;
            }
        }
        return resolveSizeFromRatio(quality, value);
    }
    throw badRequest("INVALID_IMAGE_SIZE", "图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
}

export function closestGeminiAspectRatio(value: string) {
    const ratio = parseImageRatio(value);
    const target = ratio.width / ratio.height;
    return GEMINI_SUPPORTED_RATIOS.reduce((best, item) => {
        const current = parseRatioValue(item);
        const bestRatio = parseRatioValue(best);
        return Math.abs(current.width / current.height - target) < Math.abs(bestRatio.width / bestRatio.height - target) ? item : best;
    });
}

export function geminiImageSize(quality: string | undefined, dimensions: { width: number; height: number } | null) {
    const normalized = normalizeQuality(quality);
    if (normalized) return GEMINI_IMAGE_SIZE_BY_QUALITY[normalized];
    if (dimensions) return tierFromPixelSize(dimensions.width, dimensions.height);
    return undefined;
}

/**
 * Price lookup key. The user-selected 1K/2K/4K quality is authoritative — never infer from a
 * longest-edge 1280/2560 cutoff (1K 16:9 is 1424px, 2K 16:9 is 2816px). Custom WxH maps onto
 * native preset pixels, then Seedream area bands. Ratio + auto quality uses the model's default spec.
 */
export function pricingSpec(quality: string | undefined, size: string | undefined, presets?: AspectPreset[]) {
    const normalized = normalizeQuality(quality);
    if (normalized === "high") return "4K";
    if (normalized === "medium" || normalized === "hd") return "2K";
    if (normalized === "low" || normalized === "standard") return "1K";
    const value = (size ?? "").trim();
    const dimensions = parseImageDimensions(value);
    if (dimensions) return tierFromPixelSize(dimensions.width, dimensions.height, presets ?? defaultAspectPresets());
    return undefined;
}
