import type { SiteServices } from "@/hooks/use-site-services";

/**
 * Top navigation for signed-in users. Platform configuration (channels, prices, storage, PiAPI pool)
 * moved to the admin area, so it no longer appears here.
 * Glass glyphs are Nucleo files in /public/icons/nav, sized to the 24px grid they were drawn on.
 * `path` is explicit because a slug is also an i18n key, and the two do not always match.
 */
export const navigationTools = [
    {
        slug: "canvas",
        path: "/canvas",
        icon: "/icons/nav/app-stack.svg",
    },
    {
        slug: "image",
        path: "/image",
        icon: "/icons/nav/image.svg",
    },
    {
        slug: "video",
        path: "/video",
        icon: "/icons/nav/square-pointer.svg",
    },
    {
        slug: "assets",
        path: "/assets",
        icon: "/icons/nav/box.svg",
    },
    {
        slug: "openPlatform",
        path: "/open",
        icon: "/icons/nav/atomic-orbits.svg",
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];

export function visibleNavigationTools(services: SiteServices) {
    return navigationTools.filter((tool) => {
        if (tool.slug === "image") return services.imageEnabled;
        if (tool.slug === "video") return services.videoEnabled;
        if (tool.slug === "openPlatform") return services.openPlatformEnabled;
        return true;
    });
}

/** Highlights the entry whose first path segment matches, so nested routes stay highlighted. */
export function navigationToolSlugForPath(pathname: string): NavigationToolSlug | undefined {
    const segment = pathname.split("/").filter(Boolean)[0];
    if (!segment) return undefined;
    return navigationTools.find((tool) => tool.path === `/${segment}`)?.slug;
}
