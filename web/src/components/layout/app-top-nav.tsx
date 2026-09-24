import { Bot, Menu, Settings2 } from "lucide-react";
import { Button, Drawer, Tooltip } from "antd";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useSiteServices } from "@/hooks/use-site-services";
import { AppSidebar } from "./app-sidebar";
import { UserStatusActions } from "./user-status-actions";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { useAuthModalStore } from "@/stores/use-auth-modal-store";
import { useAccountDrawerStore } from "@/stores/use-account-drawer-store";
import { useConfigStore } from "@/stores/use-config-store";
import { ThemeModeToggle } from "./theme-mode-toggle";

const AccountDrawer = lazy(() => import("@/components/account/account-drawer").then(({ AccountDrawer: Component }) => ({ default: Component })));
const AppConfigModal = lazy(() => import("@/components/layout/app-config-modal").then(({ AppConfigModal: Component }) => ({ default: Component })));

const titles: Record<string, string> = { image: "图片生成", video: "视频生成", assets: "我的资产", canvas: "我的画布", open: "开放平台" };
export function AppTopNav() {
    const { pathname } = useLocation();
    const [params, setParams] = useSearchParams();
    const [mobileOpen, setMobileOpen] = useState(false);
    const autoConnectRef = useRef(false);
    const token = useAgentStore((s) => s.token);
    const enabled = useAgentStore((s) => s.enabled);
    const connected = useAgentStore((s) => s.connected);
    const connect = useAgentStore((s) => s.connectAgent);
    const toggleAgent = useAgentStore((s) => s.togglePanel);
    const services = useSiteServices();
    const user = useAuthStore((s) => s.user);
    const registrationEnabled = useAuthStore((s) => s.site.registrationEnabled);
    const openAuth = useAuthModalStore((s) => s.openModal);
    const openConfig = useConfigStore((s) => s.openConfigDialog);
    const isConfigOpen = useConfigStore((s) => s.isConfigOpen);
    const accountOpen = useAccountDrawerStore((s) => s.isOpen);
    const immersive = /^\/canvas\/[^/]+/.test(pathname);
    useEffect(() => {
        if (!services.agentEnabled || autoConnectRef.current || enabled || connected || !token.trim()) return;
        autoConnectRef.current = true;
        connect({ silent: true });
    }, [services.agentEnabled, enabled, connected, token, connect]);
    return <>
        {!immersive ? <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border px-4 lg:px-7">
            <div className="flex min-w-0 items-center gap-3">
                <Button type="text" className="md:!hidden" aria-label="打开导航" icon={<Menu size={20} />} onClick={() => setMobileOpen(true)} />
                {pathname === "/" ? <input aria-label="搜索精选作品" value={params.get("q") || ""} onChange={(e) => { const next = new URLSearchParams(params); e.target.value ? next.set("q", e.target.value) : next.delete("q"); setParams(next, { replace: true }); }} placeholder="搜索灵感：风格、场景、主题…" className="h-10 w-full max-w-[400px] rounded-lg border border-border bg-card px-4 text-sm outline-none sm:w-[360px]" /> : <h1 className="truncate text-lg font-semibold">{titles[pathname.split("/")[1]] || "无限创作"}</h1>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
                <ThemeModeToggle />
                {user ? <>
                    <UserStatusActions showConfig={false} showAnnouncements={false} />
                    <Tooltip title="偏好设置">
                        <Button type="text" aria-label="偏好设置" icon={<Settings2 size={19} />} onClick={() => openConfig(false)} />
                    </Tooltip>
                    {services.agentEnabled ? <Button type="text" aria-label="Agent 助手" icon={<Bot size={19} />} onClick={toggleAgent} /> : null}
                </> : <><Button type="text" onClick={() => openAuth({ mode: "login" })}>登录</Button>{registrationEnabled ? <Button type="primary" onClick={() => openAuth({ mode: "register" })}>注册</Button> : null}</>}
            </div>
        </header> : null}
        <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} placement="left" size={260} styles={{ body: { padding: 0 } }}><AppSidebar mobile onNavigate={() => setMobileOpen(false)} /></Drawer>
        {isConfigOpen ? <Suspense fallback={<div className="fixed inset-y-0 right-0 z-[1050] grid w-[min(520px,100vw)] place-items-center border-l border-border bg-background text-sm text-muted-foreground" role="status">正在打开偏好设置…</div>}><AppConfigModal /></Suspense> : null}
        {accountOpen || params.get("recharge") === "1" ? <Suspense fallback={<div className="fixed inset-y-0 right-0 z-[1050] grid w-[min(420px,100vw)] place-items-center border-l border-border bg-background text-sm text-muted-foreground" role="status">正在打开账户…</div>}><AccountDrawer /></Suspense> : null}
    </>;
}
