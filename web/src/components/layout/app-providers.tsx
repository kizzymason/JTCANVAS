import type { ReactNode } from "react";
import { useEffect, useLayoutEffect } from "react";
import { App, ConfigProvider } from "antd";
import enUS from "antd/es/locale/en_US";
import zhCN from "antd/es/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { useTranslation } from "react-i18next";

import { ClientRootInit } from "@/components/layout/client-root-init";
import type { AppLocale } from "@/i18n";
import { getAntThemeConfig } from "@/lib/app-theme";
import { useAuthStore } from "@/stores/use-auth-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useFrontendThemeStore } from "@/stores/use-frontend-theme-store";
import { getBrandAntTheme } from "@/lib/brand-theme";

export function AppProviders({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
    const { i18n, t } = useTranslation();
    const adminTheme = useThemeStore((state) => state.theme);
    const frontendTheme = useFrontendThemeStore((state) => state.theme);
    const siteName = useAuthStore((state) => state.site.siteName);
    const activeTheme = admin ? adminTheme : frontendTheme;
    const dark = activeTheme === "dark";
    const locale = i18n.resolvedLanguage as AppLocale;

    useLayoutEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.classList.toggle("gravity", !admin);
        document.documentElement.style.colorScheme = dark ? "dark" : "light";
    }, [dark, admin]);

    useEffect(() => {
        if (!("onscrollend" in document)) return;

        const getScrollContainer = (event: Event): HTMLElement | null => {
            if (event.target === document) return document.documentElement;
            return event.target instanceof HTMLElement ? event.target : null;
        };
        const markScrolling = (event: Event) => getScrollContainer(event)?.classList.add("is-scrolling");
        const clearScrolling = (event: Event) => getScrollContainer(event)?.classList.remove("is-scrolling");

        document.addEventListener("scroll", markScrolling, { capture: true, passive: true });
        document.addEventListener("scrollend", clearScrolling, { capture: true, passive: true });
        return () => {
            document.removeEventListener("scroll", markScrolling, true);
            document.removeEventListener("scrollend", clearScrolling, true);
        };
    }, []);

    useEffect(() => {
        document.documentElement.lang = locale;
        document.title = siteName || t("meta.title");
        document.querySelector('meta[name="description"]')?.setAttribute("content", t("meta.description"));
        dayjs.locale(locale === "zh-CN" ? "zh-cn" : "en");
    }, [locale, siteName, t]);

    return (
        <ConfigProvider locale={locale === "zh-CN" ? zhCN : enUS} theme={admin ? getAntThemeConfig(dark) : getBrandAntTheme(frontendTheme)}>
            <App>
                <ClientRootInit>{children}</ClientRootInit>
            </App>
        </ConfigProvider>
    );
}
