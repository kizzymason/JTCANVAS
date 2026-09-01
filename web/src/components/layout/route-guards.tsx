import { Spin } from "antd";
import { type ReactNode, useLayoutEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuthStore } from "@/stores/use-auth-store";
import { useAuthModalStore } from "@/stores/use-auth-modal-store";
import { useSiteServices } from "@/hooks/use-site-services";

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

/** Sends the user back to the canvas when an admin has turned the matching product surface off. */
export function RequireSiteService({ service, children }: { service: "image" | "video"; children: ReactNode }) {
    const ready = useAuthStore((state) => state.ready);
    const services = useSiteServices();

    if (!ready) return <Loading />;
    if (service === "image" && !services.imageEnabled) return <Navigate to="/canvas" replace />;
    if (service === "video" && !services.videoEnabled) return <Navigate to="/canvas" replace />;
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
