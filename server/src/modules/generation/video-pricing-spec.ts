/** Spec suffix for Seedance 含视 (the request includes a video reference). */
export const VIDEO_INPUT_SPEC_SUFFIX = "-video";

export function isVideoMime(mimeType: string | undefined) {
    return (mimeType ?? "").toLowerCase().startsWith("video/");
}

/** Normalises UI values such as 720p / 4K / auto onto the digits stored on price rows. */
export function normalizeVideoPricingResolution(resolution: string | undefined) {
    const raw = (resolution ?? "").trim().replace(/p$/i, "");
    if (!raw || raw === "auto" || raw === "high" || raw === "medium") return "720";
    if (raw === "low") return "480";
    if (raw.toLowerCase() === "4k") return "2160";
    if (raw.toLowerCase() === "2k") return "1440";
    return raw;
}

/** Resolution used for price rows and upstream requests. 480p stays 480p. */
export function billedVideoResolution(resolution: string | undefined, _modelName?: string) {
    return normalizeVideoPricingResolution(resolution);
}

/**
 * Price-row spec for a video estimate.
 * `720` = 无视 (no video input). `720-video` = 含视 (at least one video reference).
 */
export function videoPricingSpec(resolution: string | undefined, hasVideoReference: boolean, modelName?: string) {
    const value = billedVideoResolution(resolution, modelName);
    return hasVideoReference ? `${value}${VIDEO_INPUT_SPEC_SUFFIX}` : value;
}
