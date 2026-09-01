import { lazy, Suspense, type ReactNode } from "react";
import { Spin } from "antd";
import { createBrowserRouter, Outlet } from "react-router-dom";

import { AccountRouteRedirect } from "@/components/account/account-drawer";
import { AuthModal } from "@/components/auth/auth-modal";
import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { LoginRouteRedirect, RequireAdmin, RequireAuth, RequireSiteService } from "@/components/layout/route-guards";
import UserLayout from "@/layouts/user-layout";
import HomePage from "@/pages/home";
import NotFound from "@/pages/not-found";

// The canvas editor and the admin area are the two heaviest bundles, and most sessions need only one
// of them, so every branch is code-split rather than shipped in the first-load chunk.
const AssetsPage = lazy(() => import("@/pages/assets"));
const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const ImagePage = lazy(() => import("@/pages/image"));
const VideoPage = lazy(() => import("@/pages/video"));
const AdminLayout = lazy(() => import("@/layouts/admin-layout"));
const AdminOverviewPage = lazy(() => import("@/pages/admin/overview"));
const AdminUsersPage = lazy(() => import("@/pages/admin/users"));
const AdminChannelsPage = lazy(() => import("@/pages/admin/channels"));
const AdminPricingPage = lazy(() => import("@/pages/admin/pricing"));
const AdminFinancePage = lazy(() => import("@/pages/admin/finance"));
const AdminCardsPage = lazy(() => import("@/pages/admin/cards"));
const AdminTasksPage = lazy(() => import("@/pages/admin/tasks"));
const AdminStoragePage = lazy(() => import("@/pages/admin/storage"));
const AdminServicesPage = lazy(() => import("@/pages/admin/services"));
const AdminPiapiPage = lazy(() => import("@/pages/admin/piapi"));
const AdminAuditPage = lazy(() => import("@/pages/admin/audit"));
const AdminSettingsPage = lazy(() => import("@/pages/admin/settings"));
const AdminDocsPage = lazy(() => import("@/pages/admin/docs"));

function Loading() {
    return (
        <div className="flex h-full min-h-[240px] items-center justify-center bg-background">
            <Spin />
        </div>
    );
}

function Lazy({ children }: { children: ReactNode }) {
    return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

function AppShell() {
    return (
        <>
            <AuthModal />
            <Outlet />
        </>
    );
}

export const router = createBrowserRouter([
    {
        element: <AppShell />,
        children: [
            // Public: the marketing homepage. Login/register is a dialog, not a standalone page.
            {
                element: (
                    <UserLayout>
                        <AnalyticsTracker />
                        <Outlet />
                    </UserLayout>
                ),
                children: [{ path: "/", element: <HomePage /> }],
            },
            {
                path: "/login",
                element: <LoginRouteRedirect />,
            },

            // Signed-in users.
            {
                element: (
                    <RequireAuth>
                        <UserLayout>
                            <AnalyticsTracker />
                            <Outlet />
                        </UserLayout>
                    </RequireAuth>
                ),
                children: [
                    { path: "/canvas", element: <Lazy><CanvasPage /></Lazy> },
                    { path: "/canvas/:id", element: <Lazy><CanvasProjectPage /></Lazy> },
                    { path: "/image", element: <RequireSiteService service="image"><Lazy><ImagePage /></Lazy></RequireSiteService> },
                    { path: "/video", element: <RequireSiteService service="video"><Lazy><VideoPage /></Lazy></RequireSiteService> },
                    { path: "/assets", element: <Lazy><AssetsPage /></Lazy> },
                    { path: "/account", element: <AccountRouteRedirect /> },
                ],
            },

            // Administrators only; its own left-sidebar shell.
            {
                path: "/admin",
                element: (
                    <RequireAdmin>
                        <Lazy>
                            <AdminLayout />
                        </Lazy>
                    </RequireAdmin>
                ),
                children: [
                    { index: true, element: <Lazy><AdminOverviewPage /></Lazy> },
                    { path: "users", element: <Lazy><AdminUsersPage /></Lazy> },
                    { path: "channels", element: <Lazy><AdminChannelsPage /></Lazy> },
                    { path: "pricing", element: <Lazy><AdminPricingPage /></Lazy> },
                    { path: "finance", element: <Lazy><AdminFinancePage /></Lazy> },
                    { path: "cards", element: <Lazy><AdminCardsPage /></Lazy> },
                    { path: "tasks", element: <Lazy><AdminTasksPage /></Lazy> },
                    { path: "storage", element: <Lazy><AdminStoragePage /></Lazy> },
                    { path: "services", element: <Lazy><AdminServicesPage /></Lazy> },
                    { path: "piapi", element: <Lazy><AdminPiapiPage /></Lazy> },
                    { path: "audit", element: <Lazy><AdminAuditPage /></Lazy> },
                    { path: "settings", element: <Lazy><AdminSettingsPage /></Lazy> },
                    { path: "docs", element: <Lazy><AdminDocsPage /></Lazy> },
                ],
            },

            { path: "*", element: <NotFound /> },
        ],
    },
]);
