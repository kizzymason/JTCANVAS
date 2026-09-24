import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "./styles/globals.css";
import "./styles/brand.css";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@/components/layout/app-providers";
import "@/i18n";
import { initAnalytics } from "@/lib/analytics";
import { listenForStaleChunks } from "@/lib/stale-chunk";
import { router } from "@/router";

listenForStaleChunks();

function scheduleAnalytics() {
    const start = () => initAnalytics();
    const idle = () => {
        if (typeof requestIdleCallback === "function") {
            requestIdleCallback(start, { timeout: 4000 });
            return;
        }
        window.setTimeout(start, 0);
    };
    if (document.readyState === "complete") {
        idle();
        return;
    }
    window.addEventListener("load", idle, { once: true });
}

scheduleAnalytics();

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

const subscribeRoute = (notify: () => void) => router.subscribe(notify);
const routeSnapshot = () => router.state.location.pathname;
function Root() {
    const path = React.useSyncExternalStore(subscribeRoute, routeSnapshot);
    return <AppProviders admin={path === "/admin" || path.startsWith("/admin/")}>
            <RouterProvider router={router} useTransitions={false} />
        </AppProviders>;
}

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <Root />
    </React.StrictMode>,
);
