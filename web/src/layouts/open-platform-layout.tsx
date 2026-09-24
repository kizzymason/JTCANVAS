import { Button, Drawer, Layout, Menu, Tag } from "antd";
import { ArrowLeft, BookOpen, Gauge, KeyRound, Layers, Menu as MenuIcon, ScrollText, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuthStore } from "@/stores/use-auth-store";

const { Sider, Content, Header } = Layout;

type ConsoleNavItem = { key: string; path: string; icon: typeof Gauge; labelKey: string };

const navGroups: Array<{ titleKey: string; items: ConsoleNavItem[] }> = [
    {
        titleKey: "openPlatform.nav.groupUsage",
        items: [
            { key: "console", path: "/open/console", icon: Gauge, labelKey: "openPlatform.nav.dashboard" },
            { key: "logs", path: "/open/console/logs", icon: ScrollText, labelKey: "openPlatform.nav.logs" },
        ],
    },
    {
        titleKey: "openPlatform.nav.groupIntegration",
        items: [
            { key: "tokens", path: "/open/console/tokens", icon: KeyRound, labelKey: "openPlatform.nav.tokens" },
            { key: "models", path: "/open/console/models", icon: Layers, labelKey: "openPlatform.nav.models" },
            { key: "docs", path: "/open/console/docs", icon: BookOpen, labelKey: "openPlatform.nav.docs" },
        ],
    },
    {
        titleKey: "openPlatform.nav.groupAccount",
        items: [{ key: "profile", path: "/open/console/profile", icon: UserRound, labelKey: "openPlatform.nav.profile" }],
    },
];

/**
 * Console shell for resellers, deliberately the same SaaS skeleton as the admin area so operators
 * moving between the two do not have to relearn the layout.
 */
export default function OpenPlatformLayout() {
    const { t } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    const user = useAuthStore((state) => state.user);
    const site = useAuthStore((state) => state.site);
    const [navigationOpen, setNavigationOpen] = useState(false);

    // Longest match wins so /open/console/logs does not also light up the dashboard.
    const selectedKey = useMemo(() => {
        const all = navGroups.flatMap((group) => group.items);
        const matched = all.filter((item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
        return matched?.key ?? "console";
    }, [location.pathname]);

    const menuItems = navGroups.map((group) => ({
        key: group.titleKey,
        type: "group" as const,
        label: t(group.titleKey),
        children: group.items.map((item) => ({
            key: item.key,
            icon: <item.icon className="size-4" />,
            label: <Link to={item.path}>{t(item.labelKey)}</Link>,
        })),
    }));

    return (
        <Layout className="h-dvh overflow-hidden">
            <Sider
                width={216}
                theme="dark"
                className="!hidden border-r border-border md:!block [&>.ant-layout-sider-children]:flex [&>.ant-layout-sider-children]:h-full [&>.ant-layout-sider-children]:min-h-0 [&>.ant-layout-sider-children]:flex-col [&>.ant-layout-sider-children]:overflow-hidden"
            >
                <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-4">
                    <img src="/logo.svg?v=jtcanvas" alt="" aria-hidden="true" className="size-[26px] shrink-0 object-contain" />
                    <span className="truncate text-sm font-semibold">{t("openPlatform.title")}</span>
                </div>
                <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto">
                    <Menu mode="inline" selectedKeys={[selectedKey]} items={menuItems} className="border-none" style={{ background: "transparent" }} />
                </div>
            </Sider>
            <Drawer open={navigationOpen} onClose={() => setNavigationOpen(false)} placement="left" title={t("openPlatform.title")} size={260}>
                <Menu mode="inline" selectedKeys={[selectedKey]} items={menuItems} onClick={() => setNavigationOpen(false)} />
            </Drawer>

            <Layout className="min-w-0">
                <Header className="flex items-center justify-between gap-2 border-b border-border !px-4" style={{ height: 64, lineHeight: "64px" }}>
                    <div className="flex min-w-0 items-center gap-2"><Button type="text" className="md:!hidden" icon={<MenuIcon size={20} />} aria-label="打开控制台导航" onClick={() => setNavigationOpen(true)} /><span className="truncate text-sm font-medium text-foreground">{site.siteName}</span></div>
                    <div className="flex items-center gap-2 leading-none">
                        {user?.role === "admin" ? <Tag color="gold">{t("openPlatform.adminPreview")}</Tag> : null}
                        <span className="hidden px-1 text-sm text-muted-foreground sm:block">{user?.username}</span>
                        <Button type="text" icon={<ArrowLeft className="size-4" />} onClick={() => navigate("/canvas")}>
                            {t("openPlatform.backToApp")}
                        </Button>
                    </div>
                </Header>
                <Content className="min-h-0 overflow-y-auto bg-background p-4 lg:p-6">
                    <Outlet />
                </Content>
            </Layout>
        </Layout>
    );
}
