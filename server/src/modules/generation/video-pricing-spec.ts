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
    return raw;
}

/**
 * Price-row spec for a video estimate.
 * `720` = 无视 (no video input). `720-video` = 含视 (at least one video reference).
 */
export function videoPricingSpec(resolution: string | undefined, hasVideoReference: boolean) {
    const value = normalizeVideoPricingResolution(resolution);
    return hasVideoReference ? `${value}${VIDEO_INPUT_SPEC_SUFFIX}` : value;
}
