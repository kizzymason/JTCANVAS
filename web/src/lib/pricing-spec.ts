import { parsePixelSize, qualityToResolutionTier, tierFromPixelSize, type AspectPreset } from "@/lib/aspect-presets";

/**
 * Derives the size tier a price lookup should use, mirroring the server's `pricingSpec`.
 *
 * The selected 1K/2K/4K quality is the price key. Custom WxH matches native preset pixels, then
 * Seedream area bands — never a 1280/2560 longest-edge cutoff.
 */
export function pricingSpecFor(quality: string | undefined, size: string | undefined, presets?: AspectPreset[]) {
    const fromQuality = qualityToResolutionTier(quality);
    if (fromQuality) return fromQuality;
    const dimensions = parsePixelSize((size ?? "").trim());
    if (dimensions) return tierFromPixelSize(dimensions.width, dimensions.height, presets);
    return undefined;
}
