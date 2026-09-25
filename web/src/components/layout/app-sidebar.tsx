import { Box, Code2, HelpCircle, Home, Image, Video, Workflow } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/use-auth-store";
import { requireAuth } from "@/stores/use-auth-modal-store";
import { useAnnouncementStore } from "@/stores/use-announcement-store";
import { useSiteServices } from "@/hooks/use-site-services";
import styles from "./app-shell.module.css";

const pagePreloaders: Record<string, () => Promise<unknown>> = {
    "/image": () => import("@/pages/image"),
    "/video": () => import("@/pages/video"),
    "/canvas": () => import("@/pages/canvas"),
    "/assets": () => import("@/pages/assets"),
    "/open": () => Promise.all([import("@/layouts/open-platform-layout"), import("@/pages/open")]),
};

export function AppSidebar({ onNavigate, mobile = false }: { onNavigate?: () => void; mobile?: boolean }) {
    const { pathname } = useLocation();
    const user = useAuthStore((s) => s.user);
    const services = useSiteServices();
    const openAnnouncements = useAnnouncementStore((s) => s.openList);
    const preload = (path: string) => { if (user) void pagePreloaders[path]?.().catch(() => undefined); };
    const items = [
        { path: "/", title: "首页", icon: Home, show: true },
        { path: "/image", title: "图片生成", icon: Image, show: services.imageEnabled },
        { path: "/video", title: "视频生成", icon: Video, show: services.videoEnabled },
        { path: "/canvas", title: "无限画布", icon: Workflow, show: true },
        { path: "/assets", title: "我的资产", icon: Box, show: true },
    ];
    return <aside className={`${styles.sidebar} ${mobile ? styles.mobile : ""}`}>
        <Link to="/" onClick={onNavigate} className={styles.brand} title="JTCanvas" aria-label="JTCanvas 首页">
            <img src="/logo.svg?v=jtcanvas-sidebar-monochrome-v1" alt="" aria-hidden="true" className={styles.brandMark} />
            <span className={styles.brandWordmark}><span>JT</span><span>Canvas</span></span>
        </Link>
        <nav className={styles.navigation} aria-label="主导航">
            {items.filter((i) => i.show).map(({ path, title, icon: Icon }) => <Link key={path} to={path} title={title} aria-current={pathname === path || (path !== "/" && pathname.startsWith(path + "/")) ? "page" : undefined} onPointerEnter={() => preload(path)} onFocus={() => preload(path)} onClick={(event) => { if (path !== "/" && requireAuth(path)) event.preventDefault(); onNavigate?.(); }}><Icon size={20} /><span>{title}</span></Link>)}
        </nav>
        <div className={styles.bottom}>
            {services.openPlatformEnabled ? <Link to="/open" title="API 开放平台" onPointerEnter={() => preload("/open")} onFocus={() => preload("/open")} onClick={(event) => { if (requireAuth("/open")) event.preventDefault(); onNavigate?.(); }}><Code2 size={20} /><span>API 开放平台</span></Link> : null}
            <button onClick={openAnnouncements} title="公告与社区"><HelpCircle size={20} /><span>公告与社区</span></button>
        </div>
    </aside>;
}
