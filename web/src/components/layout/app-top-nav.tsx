import { Bot, Menu } from "lucide-react";
import { Button, Tooltip } from "antd";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useSiteServices } from "@/hooks/use-site-services";
import { navigationToolSlugForPath, visibleNavigationTools } from "@/constant/navigation-tools";
import { AccountDrawer } from "@/components/account/account-drawer";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { requireAuth } from "@/stores/use-auth-modal-store";

const NAV_SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.72 } as const;

export function AppTopNav() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const reduceMotion = useReducedMotion();
    const services = useSiteServices();
    const user = useAuthStore((state) => state.user);
    const tools = visibleNavigationTools(services);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const activeToolSlug = navigationToolSlugForPath(pathname);

    useEffect(() => {
        if (!services.agentEnabled) return;
        if (autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        autoConnectRef.current = true;
        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent, services.agentEnabled]);

    return (
        <>
            {!hideHeader ? (
                <header className="sticky top-0 z-20 h-20 shrink-0 border-b border-stone-200 bg-background/90 backdrop-blur-xl dark:border-stone-800">
                    <div className="mx-auto flex h-full max-w-7xl items-stretch justify-between gap-5 px-6">
                        <div className="flex min-w-0 items-center">
                            <Link to="/" className="flex h-full shrink-0 items-center gap-2 text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300">
                                <span
                                    className="size-5 shrink-0 bg-current"
                                    style={{
                                        mask: "url(/logo.svg) center / contain no-repeat",
                                        WebkitMask: "url(/logo.svg) center / contain no-repeat",
                                    }}
                                />
                                <span className="shrink-0 text-[13px] font-semibold leading-none tracking-[0.16em]">{t("topNav.brand")}</span>
                            </Link>

                            <button
                                type="button"
                                className="ml-3 inline-flex size-10 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 md:hidden dark:text-stone-300 dark:hover:text-white"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label={t("topNav.openMenu")}
                                title={t("topNav.menu")}
                            >
                                <Menu className="size-6" />
                            </button>

                            <LayoutGroup id="app-top-nav">
                                <nav className="ml-8 hidden h-20 min-w-0 items-center gap-1 overflow-visible md:flex">
                                    {tools.map((tool) => {
                                        const active = tool.slug === activeToolSlug;
                                        return (
                                            <Link
                                                key={tool.slug}
                                                to={tool.path}
                                                aria-current={active ? "page" : undefined}
                                                onClick={(event) => {
                                                    if (!user && requireAuth(tool.path)) event.preventDefault();
                                                }}
                                                className={cn(
                                                    "group relative flex h-20 shrink-0 items-center gap-2 px-3 text-[14px] leading-none",
                                                    "transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                                                    !active &&
                                                        "before:pointer-events-none before:absolute before:inset-x-0 before:top-5 before:h-10 before:rounded-full before:bg-stone-950/[0.04] before:opacity-0 before:transition-opacity before:duration-300 before:ease-[cubic-bezier(0.22,1,0.36,1)] hover:before:opacity-100 dark:before:bg-white/[0.06]",
                                                    active
                                                        ? "font-medium text-stone-950 dark:text-stone-50"
                                                        : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200",
                                                )}
                                            >
                                                {active ? (
                                                    <motion.span
                                                        layoutId={reduceMotion ? undefined : "app-top-nav-active"}
                                                        aria-hidden
                                                        className="absolute inset-x-0 top-5 h-10 rounded-full bg-stone-950/[0.06] dark:bg-white/[0.1]"
                                                        transition={reduceMotion ? { duration: 0 } : NAV_SPRING}
                                                    />
                                                ) : null}
                                                <img
                                                    src={tool.icon}
                                                    alt=""
                                                    aria-hidden
                                                    draggable={false}
                                                    className={cn(
                                                        "relative z-[1] size-[22px] shrink-0 object-contain transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                                                        active ? "opacity-100" : "opacity-70 group-hover:-translate-y-px group-hover:opacity-100",
                                                    )}
                                                />
                                                <span className="relative z-[1] truncate">{t(`navigation.${tool.slug}`)}</span>
                                            </Link>
                                        );
                                    })}
                                </nav>
                            </LayoutGroup>
                        </div>

                        <div className="my-auto flex h-10 min-w-0 items-center justify-end gap-2 justify-self-end whitespace-nowrap">
                            {services.agentEnabled ? (
                                <Tooltip title={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")}>
                                    <Button type="text" shape="circle" className="!h-10 !w-10 !min-w-10" icon={<Bot className="size-5" />} onClick={togglePanel} aria-label={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")} />
                                </Tooltip>
                            ) : null}
                            <UserStatusActions />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
            <AccountDrawer />
        </>
    );
}
