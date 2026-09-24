import { lazy, Suspense, type ReactNode } from "react";
import { Spin } from "antd";
import { createBrowserRouter, Outlet } from "react-router-dom";

import { AccountRouteRedirect } from "@/components/account/account-route-redirect";
import { useAuthModalStore } from "@/stores/use-auth-modal-store";
import { RouteErrorFallback } from "@/components/layout/route-error-fallback";
import { LoginRouteRedirect, RequireAdmin, RequireAuth, RequireReseller, RequireSiteService } from "@/components/layout/route-guards";
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
const AdminVisitorsPage = lazy(() => import("@/pages/admin/visitors"));
const AdminUsersPage = lazy(() => import("@/pages/admin/users"));
const AdminChannelsPage = lazy(() => import("@/pages/admin/channels"));
const AdminPricingPage = lazy(() => import("@/pages/admin/pricing"));
const AdminFinancePage = lazy(() => import("@/pages/admin/finance"));
const AdminCardsPage = lazy(() => import("@/pages/admin/cards"));
const AdminPaymentsPage = lazy(() => import("@/pages/admin/payments"));
const AdminPackagesPage = lazy(() => import("@/pages/admin/packages"));
const AdminTasksPage = lazy(() => import("@/pages/admin/tasks"));
const AdminStoragePage = lazy(() => import("@/pages/admin/storage"));
const AdminServicesPage = lazy(() => import("@/pages/admin/services"));
const AdminPiapiPage = lazy(() => import("@/pages/admin/piapi"));
const AdminAuditPage = lazy(() => import("@/pages/admin/audit"));
const AdminHomepagePage = lazy(() => import("@/pages/admin/homepage"));
const AdminSettingsPage = lazy(() => import("@/pages/admin/settings"));
const AdminAnnouncementsPage = lazy(() => import("@/pages/admin/announcements"));
const AdminDocsPage = lazy(() => import("@/pages/admin/docs"));
const AdminResellersPage = lazy(() => import("@/pages/admin/resellers"));
const AdminResellerTiersPage = lazy(() => import("@/pages/admin/reseller-tiers"));
const OpenPlatformLayout = lazy(() => import("@/layouts/open-platform-layout"));
const OpenLandingPage = lazy(() => import("@/pages/open"));
const OpenDocsPage = lazy(() => import("@/pages/open/docs"));
const OpenConsoleDashboardPage = lazy(() => import("@/pages/open/console"));
const OpenConsoleTokensPage = lazy(() => import("@/pages/open/console/tokens"));
const OpenConsoleLogsPage = lazy(() => import("@/pages/open/console/logs"));
const OpenConsoleModelsPage = lazy(() => import("@/pages/open/console/models"));
const OpenConsoleProfilePage = lazy(() => import("@/pages/open/console/profile"));
const OpenConsoleDocsPage = lazy(() => import("@/pages/open/console/docs"));
const AdminCardShopPage = lazy(() => import("@/pages/admin/card-shop"));
const CardShopPage = lazy(() => import("@/pages/cards"));
const CardOrdersPage = lazy(() => import("@/pages/cards/orders"));
const AuthModal = lazy(() => import("@/components/auth/auth-modal").then(({ AuthModal: Component }) => ({ default: Component })));

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
    const authModalOpen = useAuthModalStore((state) => state.open);
    return (
        <>
            {authModalOpen ? <Suspense fallback={<div className="fixed inset-0 z-[1100] grid place-items-center bg-black/35 text-sm text-white" role="status">正在打开登录…</div>}><AuthModal /></Suspense> : null}
            <UserLayout>
                <Outlet />
            </UserLayout>
        </>
    );
}

export const router = createBrowserRouter([
    {
        element: <AppShell />,
        errorElement: <RouteErrorFallback />,
        children: [
            // Public: the marketing homepage. Login/register is a dialog, not a standalone page.
            {
                element: <Outlet />,
                children: [
                    { path: "/", element: <HomePage /> },
                    // The API reference is public on purpose: downstream engineers evaluate before applying.
                    {
                        path: "/open/docs",
                        element: (
                            <Lazy>
                                <OpenDocsPage />
                            </Lazy>
                        ),
                    },
                ],
            },
            {
                path: "/login",
                element: <LoginRouteRedirect />,
            },

            // Private-channel card storefront: direct link only, no account and no site chrome, so it
            // deliberately sits outside UserLayout and never appears in the navigation.
            {
                path: "/cards",
                element: (
                    <Lazy>
                        <CardShopPage />
                    </Lazy>
                ),
            },
            {
                path: "/cards/orders",
                element: (
                    <Lazy>
                        <CardOrdersPage />
                    </Lazy>
                ),
            },

            // Signed-in users.
            {
                element: (
                    <RequireAuth>
                        <Outlet />
                    </RequireAuth>
                ),
                children: [
                    {
                        path: "/canvas",
                        element: (
                            <Lazy>
                                <CanvasPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "/canvas/:id",
                        element: (
                            <Lazy>
                                <CanvasProjectPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "/image",
                        element: (
                            <RequireSiteService service="image">
                                <Lazy>
                                    <ImagePage />
                                </Lazy>
                            </RequireSiteService>
                        ),
                    },
                    {
                        path: "/video",
                        element: (
                            <RequireSiteService service="video">
                                <Lazy>
                                    <VideoPage />
                                </Lazy>
                            </RequireSiteService>
                        ),
                    },
                    {
                        path: "/assets",
                        element: (
                            <Lazy>
                                <AssetsPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "/open",
                        element: (
                            <RequireSiteService service="openPlatform">
                                <Lazy>
                                    <OpenLandingPage />
                                </Lazy>
                            </RequireSiteService>
                        ),
                    },
                    { path: "/account", element: <AccountRouteRedirect /> },
                ],
            },

            // Approved resellers only; the open platform console has its own left-sidebar shell.
            {
                path: "/open/console",
                element: (
                    <RequireReseller>
                        <Lazy>
                            <OpenPlatformLayout />
                        </Lazy>
                    </RequireReseller>
                ),
                children: [
                    {
                        index: true,
                        element: (
                            <Lazy>
                                <OpenConsoleDashboardPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "tokens",
                        element: (
                            <Lazy>
                                <OpenConsoleTokensPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "logs",
                        element: (
                            <Lazy>
                                <OpenConsoleLogsPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "models",
                        element: (
                            <Lazy>
                                <OpenConsoleModelsPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "profile",
                        element: (
                            <Lazy>
                                <OpenConsoleProfilePage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "docs",
                        element: (
                            <Lazy>
                                <OpenConsoleDocsPage />
                            </Lazy>
                        ),
                    },
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
                    { path: "homepage", element: <Lazy><AdminHomepagePage /></Lazy> },
                    {
                        index: true,
                        element: (
                            <Lazy>
                                <AdminOverviewPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "visitors",
                        element: (
                            <Lazy>
                                <AdminVisitorsPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "users",
                        element: (
                            <Lazy>
                                <AdminUsersPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "channels",
                        element: (
                            <Lazy>
                                <AdminChannelsPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "pricing",
                        element: (
                            <Lazy>
                                <AdminPricingPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "finance",
                        element: (
                            <Lazy>
                                <AdminFinancePage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "cards",
                        element: (
                            <Lazy>
                                <AdminCardsPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "payments",
                        element: (
                            <Lazy>
                                <AdminPaymentsPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "packages",
                        element: (
                            <Lazy>
                                <AdminPackagesPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "tasks",
                        element: (
                            <Lazy>
                                <AdminTasksPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "storage",
                        element: (
                            <Lazy>
                                <AdminStoragePage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "services",
                        element: (
                            <Lazy>
                                <AdminServicesPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "piapi",
                        element: (
                            <Lazy>
                                <AdminPiapiPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "audit",
                        element: (
                            <Lazy>
                                <AdminAuditPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "settings",
                        element: (
                            <Lazy>
                                <AdminSettingsPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "announcements",
                        element: (
                            <Lazy>
                                <AdminAnnouncementsPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "docs",
                        element: (
                            <Lazy>
                                <AdminDocsPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "resellers",
                        element: (
                            <Lazy>
                                <AdminResellersPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "reseller-tiers",
                        element: (
                            <Lazy>
                                <AdminResellerTiersPage />
                            </Lazy>
                        ),
                    },
                    {
                        path: "card-shop",
                        element: (
                            <Lazy>
                                <AdminCardShopPage />
                            </Lazy>
                        ),
                    },
                ],
            },

            { path: "*", element: <NotFound /> },
        ],
    },
]);
