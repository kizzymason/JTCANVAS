import { PIAPI_ASPECT_RATIOS } from "@/lib/aspect-presets";

/** Seedream 5 task types exposed through PiAPI's unified `POST /api/v1/task` endpoint. */
export const PIAPI_SEEDREAM_TASK_TYPES = ["seedream-5-lite", "seedream-5-lite-less-restriction", "seedream-5-pro", "seedream-5-pro-less-restriction"] as const;

export const DEFAULT_PIAPI_IMAGE_MODEL = "seedream-5-pro-less-restriction";

export const PIAPI_SEEDREAM_LABELS: Record<(typeof PIAPI_SEEDREAM_TASK_TYPES)[number], string> = {
    "seedream-5-lite": "Seedream 5 Lite",
    "seedream-5-lite-less-restriction": "Seedream 5 Lite 宽松",
    "seedream-5-pro": "Seedream 5 Pro",
    "seedream-5-pro-less-restriction": "Seedream 5 Pro 宽松",
};

export const PIAPI_MODEL_NAME = "seedream";
export const PIAPI_MAX_REFERENCE_IMAGES = 10;
export const PIAPI_BASE_URL = "https://api.piapi.ai";

const LITE_SIZES = ["2K", "3K"];
const PRO_SIZES = ["1K", "2K"];
const SIZE_ORDER = ["1K", "2K", "3K"];

/** Published per-image prices in USD, keyed by task type then output size. */
const PIAPI_PRICING: Record<string, Record<string, number>> = {
    "seedream-5-lite": { "2K": 0.052, "3K": 0.052 },
    "seedream-5-lite-less-restriction": { "2K": 0.065, "3K": 0.065 },
    "seedream-5-pro": { "1K": 0.068, "2K": 0.136 },
    "seedream-5-pro-less-restriction": { "1K": 0.085, "2K": 0.17 },
};
/** Pro tiers include the first reference image; every extra one is billed separately. */
const PRO_EXTRA_REFERENCE_PRICE = 0.003;

/** Cheapest Seedream image; below this a key cannot produce anything, so it counts as exhausted. */
export const PIAPI_CHEAPEST_IMAGE_USD = Math.min(...Object.values(PIAPI_PRICING).flatMap((sizes) => Object.values(sizes)));

export function isPiapiProTaskType(taskType: string) {
    return taskType.includes("pro");
}

export function piapiSupportedSizes(taskType: string) {
    return isPiapiProTaskType(taskType) ? PRO_SIZES : LITE_SIZES;
}

function parseRatio(value: string) {
    const [width, height] = value.split(":");
    const ratio = { width: Number(width), height: Number(height) };
    return ratio.width > 0 && ratio.height > 0 ? ratio : { width: 1, height: 1 };
}

/** The canvas stores sizes as ratio strings ("16:9") or pixels ("1024x1024"); map either onto PiAPI's fixed ratio list. */
export function piapiAspectRatio(size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return "1:1";
    const pixels = value.match(/^(\d+)\s*[x×*]\s*(\d+)$/i);
    const target = pixels ? Number(pixels[1]) / Number(pixels[2]) : parseRatio(value).width / parseRatio(value).height;
    if (!Number.isFinite(target) || target <= 0) return "1:1";
    return PIAPI_ASPECT_RATIOS.reduce((best, item) => {
        const current = parseRatio(item);
        const bestRatio = parseRatio(best);
        return Math.abs(current.width / current.height - target) < Math.abs(bestRatio.width / bestRatio.height - target) ? item : best;
    });
}

/** Map the shared quality setting (auto/low/medium/high or 1k/2k/4k) onto the sizes the task type accepts. */
export function piapiOutputSize(taskType: string, quality: string) {
    const supported = piapiSupportedSizes(taskType);
    const value = quality.trim().toLowerCase();
    const requested = value === "low" || value === "standard" || value === "1k" ? "1K" : value === "medium" || value === "hd" || value === "2k" ? "2K" : value === "high" || value === "4k" ? "3K" : "";
    if (!requested) return supported[0];
    if (supported.includes(requested)) return requested;
    // Clamp into the supported range instead of failing: 1K on lite becomes 2K, 3K on pro becomes 2K.
    return SIZE_ORDER.indexOf(requested) < SIZE_ORDER.indexOf(supported[0]) ? supported[0] : supported[supported.length - 1];
}

/** Estimated USD cost of one image, used to skip accounts that cannot afford the request. */
export function piapiEstimatedCost(taskType: string, size: string, referenceCount = 0) {
    const price = PIAPI_PRICING[taskType]?.[size];
    if (price === undefined) return 0;
    const extraReferences = isPiapiProTaskType(taskType) ? Math.max(0, referenceCount - 1) : 0;
    return price + extraReferences * PRO_EXTRA_REFERENCE_PRICE;
}
