/**
 * Brand icon for a model name.
 *
 * Artwork is vendored from @lobehub/icons-static-svg (MIT) into /icons/models rather than pulled in
 * as a dependency: the React package requires the whole @lobehub/ui kit as a peer, and these are
 * plain `<img>` sources, so the runtime bundle stays untouched.
 *
 * Matching is on the model name because that is the only thing every channel reliably provides —
 * upstream catalogues disagree on how (or whether) they report a vendor.
 */
export type ModelBrand = {
    /** File under /icons/models. */
    icon: string;
    /** Monochrome artwork needs inverting in dark mode; the colored logos must not be touched. */
    monochrome?: boolean;
};

/**
 * First match wins, so the order matters: narrower names come before the families that would also
 * match them (`gpt-image` before `gpt`, `seedream` before `seed`).
 */
const BRANDS: Array<{ match: RegExp; brand: ModelBrand }> = [
    { match: /claude|anthropic|opus|sonnet|haiku/, brand: { icon: "claude" } },
    { match: /gemini|imagen|nano-banana/, brand: { icon: "gemini" } },
    { match: /gpt|openai|dall-?e|o[134](-|$)|sora/, brand: { icon: "openai", monochrome: true } },
    { match: /deepseek/, brand: { icon: "deepseek" } },
    { match: /minimax|hailuo|abab/, brand: { icon: "minimax" } },
    // Seedream / Seedance / Seed-* are Volcano Engine (BytePlus) models.
    { match: /seedream|seedance|seed-|seededit|byteplus|volc/, brand: { icon: "volcengine" } },
    { match: /doubao/, brand: { icon: "doubao" } },
    // HappyHorse and Wan ship under Alibaba Cloud alongside Qwen.
    { match: /qwen|tongyi|wanx?[\d.]|happyhorse|alibaba/, brand: { icon: "qwen" } },
    { match: /kling|keling|kolors/, brand: { icon: "kling" } },
    { match: /moonshot|kimi/, brand: { icon: "moonshot", monochrome: true } },
    { match: /glm|zhipu|chatglm|cogview|cogvideo/, brand: { icon: "zhipu" } },
    { match: /grok|xai/, brand: { icon: "grok", monochrome: true } },
    { match: /flux|black-?forest/, brand: { icon: "flux", monochrome: true } },
    { match: /midjourney|niji/, brand: { icon: "midjourney", monochrome: true } },
    { match: /hunyuan|tencent/, brand: { icon: "hunyuan" } },
    { match: /step-?\d|stepfun/, brand: { icon: "stepfun" } },
];

export function modelBrand(model: string | undefined): ModelBrand | undefined {
    const name = (model ?? "").toLowerCase();
    if (!name) return undefined;
    return BRANDS.find((entry) => entry.match.test(name))?.brand;
}

export function modelBrandIconUrl(brand: ModelBrand) {
    return `/icons/models/${brand.icon}.svg`;
}
