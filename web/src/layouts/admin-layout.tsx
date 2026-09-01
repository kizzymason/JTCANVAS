import { Button, Layout, Menu } from "antd";
import { AppWindow, ArrowLeft, BarChart3, BookOpen, ClipboardList, CreditCard, Database, FileClock, Gauge, KeyRound, Layers, ScrollText, Settings, Ticket, Users } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuthStore } from "@/stores/use-auth-store";

const { Sider, Content, Header } = Layout;

type AdminNavItem = { key: string; path: string; icon: typeof Gauge; labelKey: string };

/** Grouped the way an operator thinks about the product: usage, money, supply, platform. */
const navGroups: Array<{ titleKey: string; items: AdminNavItem[] }> = [
    {
        titleKey: "admin.nav.groupOverview",
        items: [
            { key: "overview", path: "/admin", icon: Gauge, labelKey: "admin.nav.overview" },
            { key: "visitors", path: "/admin/visitors", icon: BarChart3, labelKey: "admin.nav.visitors" },
            { key: "users", path: "/admin/users", icon: Users, labelKey: "admin.nav.users" },
            { key: "tasks", path: "/admin/tasks", icon: ClipboardList, labelKey: "admin.nav.tasks" },
        ],
    },
    {
        titleKey: "admin.nav.groupFinance",
        items: [
            { key: "finance", path: "/admin/finance", icon: CreditCard, labelKey: "admin.nav.finance" },
            { key: "cards", path: "/admin/cards", icon: Ticket, labelKey: "admin.nav.cards" },
        ],
    },
    {
        titleKey: "admin.nav.groupSupply",
        items: [
            { key: "channels", path: "/admin/channels", icon: Layers, labelKey: "admin.nav.channels" },
            { key: "pricing", path: "/admin/pricing", icon: FileClock, labelKey: "admin.nav.pricing" },
            { key: "piapi", path: "/admin/piapi", icon: KeyRound, labelKey: "admin.nav.piapi" },
        ],
    },
    {
        titleKey: "admin.nav.groupPlatform",
        items: [
            { key: "storage", path: "/admin/storage", icon: Database, labelKey: "admin.nav.storage" },
            { key: "services", path: "/admin/services", icon: AppWindow, labelKey: "admin.nav.services" },
            { key: "settings", path: "/admin/settings", icon: Settings, labelKey: "admin.nav.settings" },
            { key: "audit", path: "/admin/audit", icon: ScrollText, labelKey: "admin.nav.audit" },
            { key: "docs", path: "/admin/docs", icon: BookOpen, labelKey: "admin.nav.docs" },
        ],
    },
];

/**
 * SaaS-style admin shell: fixed left sidebar, scrollable content.
 * Colours come from the antd theme tokens configured in `app-theme.ts`, not per-component dark branches.
 */
export default function AdminLayout() {
    const { t } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    const user = useAuthStore((state) => state.user);
    const site = useAuthStore((state) => state.site);

    // Longest matching path wins so /admin/users does not also light up /admin.
    const selectedKey = useMemo(() => {
        const all = navGroups.flatMap((group) => group.items);
        const matched = all.filter((item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
        return matched?.key ?? "overview";
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
                width={232}
                theme="light"
                className="overflow-hidden border-r border-stone-200 dark:border-stone-800 [&>.ant-layout-sider-children]:flex [&>.ant-layout-sider-children]:h-full [&>.ant-layout-sider-children]:min-h-0 [&>.ant-layout-sider-children]:flex-col"
            >
                <div className="flex h-14 shrink-0 items-center px-4">
                    <span className="truncate text-sm font-semibold">{t("admin.title")}</span>
                </div>
                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
                    <Menu mode="inline" selectedKeys={[selectedKey]} items={menuItems} className="border-none" style={{ background: "transparent" }} />
                </div>
            </Sider>

            <Layout className="min-w-0">
                <Header className="flex h-14 items-center justify-between border-b border-stone-200 px-6 dark:border-stone-800" style={{ height: 56, lineHeight: "56px" }}>
                    <span className="text-sm font-medium text-stone-950 dark:text-stone-100">{site.siteName}</span>
                    <div className="flex items-center gap-1 leading-none">
                        <span className="px-2 text-sm text-stone-600 dark:text-stone-300">{user?.username}</span>
                        <Button type="text" icon={<ArrowLeft className="size-4" />} onClick={() => navigate("/canvas")}>
                            {t("admin.backToApp")}
                        </Button>
                    </div>
                </Header>
                <Content className="min-h-0 overflow-y-auto bg-background p-6">
                    <Outlet />
                </Content>
            </Layout>
        </Layout>
    );
}
