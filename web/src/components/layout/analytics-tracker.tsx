import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { trackPageview } from "@/lib/analytics";
import { cachedDeviceFingerprint } from "@/lib/device-fingerprint";
import { reportVisitorBeacon } from "@/services/api/account";

function reportOwnBeacon(path: string) {
    if (path === "/admin" || path.startsWith("/admin/")) return;
    void cachedDeviceFingerprint()
        .then((fingerprint) =>
            reportVisitorBeacon({
                path,
                screen: `${window.screen.width}x${window.screen.height}`,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                fingerprint,
                webdriver: Boolean(navigator.webdriver),
            }),
        )
        .catch(() => undefined);
}

// Observe SPA route changes and report page views; failures are silent and must not affect the app.
export function AnalyticsTracker() {
    const location = useLocation();

    useEffect(() => {
        const path = `${location.pathname}${location.search}`;
        trackPageview(path);
        reportOwnBeacon(location.pathname);
    }, [location.pathname, location.search]);

    return null;
}
