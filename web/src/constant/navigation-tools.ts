import { ImagePlus, Images, Maximize2, Video } from "lucide-react";

import type { SiteServices } from "@/hooks/use-site-services";

/**
 * Top navigation for signed-in users. Platform configuration (channels, prices, storage, PiAPI pool)
 * moved to the admin area, so it no longer appears here.
 */
export const navigationTools = [
    {
        slug: "canvas",
        icon: Maximize2,
    },
    {
        slug: "image",
        icon: ImagePlus,
    },
    {
        slug: "video",
        icon: Video,
    },
    {
        slug: "assets",
        icon: Images,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];

export function visibleNavigationTools(services: SiteServices) {
    return navigationTools.filter((tool) => {
        if (tool.slug === "image") return services.imageEnabled;
        if (tool.slug === "video") return services.videoEnabled;
        return true;
    });
}
