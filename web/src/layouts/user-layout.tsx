import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AppSidebar } from "@/components/layout/app-sidebar";

import { AppTopNav } from "@/components/layout/app-top-nav";
import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { useSiteServices } from "@/hooks/use-site-services";
import { useAuthStore } from "@/stores/use-auth-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAnnouncementStore } from "@/stores/use-announcement-store";

const AgentPanel = lazy(() => import("@/components/agent/agent-panel").then(({ AgentPanel: Component }) => ({ default: Component })));
const AnnouncementModal = lazy(() => import("@/components/announcements/announcement-modal").then(({ AnnouncementModal: Component }) => ({ default: Component })));

function DeferredAgentPanel() {
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const token = useAgentStore((state) => state.token);
    const services = useSiteServices();
    const [shouldLoad, setShouldLoad] = useState(false);

    useEffect(() => {
        if (shouldLoad) return;
        if (panelOpen) {
            setShouldLoad(true);
            return;
        }
        if (!services.agentEnabled || !token.trim()) return;

        let cancelled = false;
        const load = () => { if (!cancelled) setShouldLoad(true); };
        if (typeof window.requestIdleCallback === "function") {
            const handle = window.requestIdleCallback(load);
            return () => {
                cancelled = true;
                window.cancelIdleCallback(handle);
            };
        }
        if (document.readyState === "complete") {
            const handle = window.setTimeout(load, 0);
            return () => {
                cancelled = true;
                window.clearTimeout(handle);
            };
        }
        window.addEventListener("load", load, { once: true });
        return () => {
            cancelled = true;
            window.removeEventListener("load", load);
        };
    }, [panelOpen, services.agentEnabled, shouldLoad, token]);

    if (!shouldLoad) return null;
    return <Suspense fallback={panelOpen ? <div className="fixed inset-y-16 right-0 z-[1000] flex w-[min(420px,100vw)] items-center justify-center border-l border-border bg-background text-sm text-muted-foreground" role="status">正在加载 Agent 助手…</div> : null}><AgentPanel /></Suspense>;
}

function DeferredAnnouncementModal() {
    const isOpen = useAnnouncementStore((state) => state.view.kind !== "closed");
    if (!isOpen) return null;
    return <Suspense fallback={<div className="fixed inset-0 z-[1050] grid place-items-center bg-black/35 text-sm text-white" role="status">正在打开公告…</div>}><AnnouncementModal /></Suspense>;
}

export default function UserLayout({ children }: { children: ReactNode }) {
    const pathname = useLocation().pathname;
    const ready = useAuthStore((state) => state.ready);
    const user = useAuthStore((state) => state.user);
    const privateSurface = pathname === "/canvas"
        || pathname.startsWith("/canvas/")
        || pathname === "/image"
        || pathname === "/video"
        || pathname === "/assets"
        || pathname === "/open"
        || pathname === "/account";
    const publicSurface = pathname === "/" || pathname === "/open/docs";
    const immersive = /^\/canvas\/[^/]+/.test(pathname);

    if ((!publicSurface && !privateSurface) || (privateSurface && (!ready || !user))) return <>{children}</>;

    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <AnalyticsTracker />
            {!immersive ? <AppSidebar /> : null}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            <DeferredAgentPanel />
            <DeferredAnnouncementModal />
        </div>
    );
}
