import { useMemo } from "react";

import { useAuthStore } from "@/stores/use-auth-store";
import { CanvasNodeType } from "@/types/canvas";

export type SiteServices = {
    imageEnabled: boolean;
    videoEnabled: boolean;
    agentEnabled: boolean;
};

/** Missing flags (older sessions before bootstrap finishes) stay on, matching the product default. */
export function siteServicesFrom(site: { imageGenerationEnabled?: boolean; videoGenerationEnabled?: boolean; agentEnabled?: boolean }): SiteServices {
    return {
        imageEnabled: site.imageGenerationEnabled !== false,
        videoEnabled: site.videoGenerationEnabled !== false,
        agentEnabled: site.agentEnabled !== false,
    };
}

export function useSiteServices() {
    const imageGenerationEnabled = useAuthStore((state) => state.site.imageGenerationEnabled);
    const videoGenerationEnabled = useAuthStore((state) => state.site.videoGenerationEnabled);
    const agentEnabled = useAuthStore((state) => state.site.agentEnabled);
    return useMemo(
        () => siteServicesFrom({ imageGenerationEnabled, videoGenerationEnabled, agentEnabled }),
        [agentEnabled, imageGenerationEnabled, videoGenerationEnabled],
    );
}

export function isCanvasNodeServiceEnabled(type: string, services: SiteServices) {
    if (type === CanvasNodeType.Image) return services.imageEnabled;
    if (type === CanvasNodeType.Video) return services.videoEnabled;
    return true;
}
