import { useLayoutEffect } from "react";
import { Navigate } from "react-router-dom";

import { useAccountDrawerStore } from "@/stores/use-account-drawer-store";

/** Old /account bookmarks still work: open the drawer, then land on the canvas. */
export function AccountRouteRedirect() {
    const open = useAccountDrawerStore((state) => state.open);

    useLayoutEffect(() => {
        open();
    }, [open]);

    return <Navigate to="/canvas" replace />;
}
