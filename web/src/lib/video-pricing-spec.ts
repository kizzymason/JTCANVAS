/** Mirrors server `video-pricing-spec.ts` so the live estimate hits the same price row. */
export const VIDEO_INPUT_SPEC_SUFFIX = "-video";

export function normalizeVideoPricingResolution(resolution: string | undefined) {
    const raw = (resolution ?? "").trim().replace(/p$/i, "");
    if (!raw || raw === "auto" || raw === "high" || raw === "medium") return "720";
    if (raw === "low") return "480";
    if (raw.toLowerCase() === "4k") return "2160";
    return raw;
}

export function videoPricingSpecFor(resolution: string | undefined, hasVideoReference: boolean) {
    const value = normalizeVideoPricingResolution(resolution);
    return hasVideoReference ? `${value}${VIDEO_INPUT_SPEC_SUFFIX}` : value;
}

export function hasVideoInputPricing(specPrices: Record<string, string> | undefined) {
    return Object.keys(specPrices ?? {}).some((key) => key.endsWith(VIDEO_INPUT_SPEC_SUFFIX));
}
