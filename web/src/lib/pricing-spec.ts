/**
 * Derives the size tier a price lookup should use, mirroring the server's `pricingSpec`.
 *
 * Providers charge differently per output size (PiAPI's 1K and 2K Seedream tiers, for example), so the
 * estimate has to know which tier the current settings land in.
 */
export function pricingSpecFor(quality: string | undefined, size: string | undefined) {
    const value = (quality ?? "").trim().toLowerCase();
    if (value === "high" || value === "4k") return "4K";
    if (value === "medium" || value === "hd" || value === "2k") return "2K";
    if (value === "low" || value === "standard" || value === "1k") return "1K";

    const dimensions = (size ?? "").trim().match(/^(\d+)\s*[x×*]\s*(\d+)$/i);
    if (dimensions) return tierFor(Math.max(Number(dimensions[1]), Number(dimensions[2])));
    return undefined;
}

function tierFor(longestEdge: number) {
    if (longestEdge > 2560) return "4K";
    return longestEdge > 1280 ? "2K" : "1K";
}
