import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@/components/layout/app-providers";
import "@/i18n";
import { initAnalytics } from "@/lib/analytics";
import { router } from "@/router";

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

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
