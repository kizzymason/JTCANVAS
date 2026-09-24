import { Alert, Button, Spin } from "antd";
import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuthStore } from "@/stores/use-auth-store";
import { useAuthModalStore } from "@/stores/use-auth-modal-store";
import { useSiteServices } from "@/hooks/use-site-services";
import { resellerApi } from "@/services/api/reseller";

/** Shown while the bootstrap call is still in flight, so a guard never redirects on unknown state. */
function Loading() {
    return (
        <div className="flex h-dvh items-center justify-center bg-background">
            <Spin />
        </div>
    );
}

function UnauthenticatedHomeRedirect({ from }: { from: string }) {
    useLayoutEffect(() => {
        useAuthModalStore.getState().openModal({ redirectTo: from });
    }, [from]);
    return <Navigate to="/" replace />;
}

/**
 * The whole app is behind a login wall except the homepage. An unauthenticated visitor stays on
 * the homepage with the login dialog, and is sent to the attempted path after signing in.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
    const ready = useAuthStore((state) => state.ready);
    const user = useAuthStore((state) => state.user);
    const location = useLocation();

    if (!ready) return <Loading />;
    if (!user) return <UnauthenticatedHomeRedirect from={`${location.pathname}${location.search}`} />;
    return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
    const ready = useAuthStore((state) => state.ready);
    const user = useAuthStore((state) => state.user);
    const location = useLocation();

    if (!ready) return <Loading />;
    if (!user) return <UnauthenticatedHomeRedirect from={`${location.pathname}${location.search}`} />;
    // A signed-in non-admin is bounced to the app rather than shown an empty admin shell.
    if (user.role !== "admin") return <Navigate to="/canvas" replace />;
    return <>{children}</>;
}

/**
 * All signed-in accounts may enroll. Explicit suspension is resolved by the server, not user roles.
 */
export function RequireReseller({ children }: { children: ReactNode }) {
    const ready = useAuthStore((state) => state.ready);
    const user = useAuthStore((state) => state.user);
    const services = useSiteServices();
    const location = useLocation();
    const [access, setAccess] = useState<{ userId: string; allowed?: boolean; error?: boolean } | null>(null);
    const [attempt, setAttempt] = useState(0);
    const userId = user?.id;
    useEffect(() => {
        if (!ready || !userId || !services.openPlatformEnabled) return;
        let active = true;
        setAccess(null);
        void resellerApi.status().then(
            (result) => { if (active) setAccess({ userId, allowed: result.canUseConsole }); },
            () => { if (active) setAccess({ userId, error: true }); },
        );
        return () => { active = false; };
    }, [ready, userId, services.openPlatformEnabled, attempt]);

    if (!ready) return <Loading />;
    if (!user) return <UnauthenticatedHomeRedirect from={`${location.pathname}${location.search}`} />;
    if (!services.openPlatformEnabled) return <Navigate to="/canvas" replace />;
    if (!access || access.userId !== userId) return <Loading />;
    if (access.error) return <Alert type="error" message="加载开放平台权限失败" action={<Button onClick={() => setAttempt((value) => value + 1)}>重试</Button>} />;
    if (!access.allowed) return <Navigate to="/open" replace />;
    return <>{children}</>;
}

/** Sends the user back to the canvas when an admin has turned the matching product surface off. */
export function RequireSiteService({ service, children }: { service: "image" | "video" | "openPlatform"; children: ReactNode }) {
    const ready = useAuthStore((state) => state.ready);
    const services = useSiteServices();

    if (!ready) return <Loading />;
    if (service === "image" && !services.imageEnabled) return <Navigate to="/canvas" replace />;
    if (service === "video" && !services.videoEnabled) return <Navigate to="/canvas" replace />;
    if (service === "openPlatform" && !services.openPlatformEnabled) return <Navigate to="/canvas" replace />;
    return <>{children}</>;
}

/** Old /login bookmarks open the homepage dialog instead of a standalone page. */
export function LoginRouteRedirect() {
    const ready = useAuthStore((state) => state.ready);
    const user = useAuthStore((state) => state.user);

    useLayoutEffect(() => {
        if (!ready || user) return;
        useAuthModalStore.getState().openModal({ redirectTo: "/canvas" });
    }, [ready, user]);

    if (!ready) return <Loading />;
    if (user) return <Navigate to="/canvas" replace />;
    return <Navigate to="/" replace />;
}
