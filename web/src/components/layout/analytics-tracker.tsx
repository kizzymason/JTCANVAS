import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { trackPageview } from "@/lib/analytics";
import { reportVisitorBeacon } from "@/services/api/account";

const IDLE_TIMEOUT_MS = 4000;
const SAME_PATH_DEBOUNCE_MS = 800;

let lastQueued = { path: "", at: 0 };

function isAdminPath(path: string) {
    return path === "/admin" || path.startsWith("/admin/");
}

function afterLoadIdle(run: () => void) {
    const start = () => {
        if (typeof requestIdleCallback === "function") {
            requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
            return;
        }
        window.setTimeout(run, 0);
    };
    if (document.readyState === "complete") {
        start();
        return;
    }
    window.addEventListener("load", start, { once: true });
}

/**
 * Queue a visitor beacon after the window has loaded and gone idle. Fingerprints stay on register
 * submit only — they must never run on homepage paint.
 */
function queueOwnBeacon(path: string) {
    if (isAdminPath(path)) return;
    const now = Date.now();
    if (path === lastQueued.path && now - lastQueued.at < SAME_PATH_DEBOUNCE_MS) return;
    lastQueued = { path, at: now };

    afterLoadIdle(() => {
        void reportVisitorBeacon({
            path,
            screen: `${window.screen.width}x${window.screen.height}`,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            webdriver: Boolean(navigator.webdriver),
        });
    });
}

// Observe SPA route changes and report page views; failures are silent and must not affect the app.
export function AnalyticsTracker() {
    const location = useLocation();

    useEffect(() => {
        const path = `${location.pathname}${location.search}`;
        trackPageview(path);
        queueOwnBeacon(location.pathname);
    }, [location.pathname, location.search]);

    return null;
}
