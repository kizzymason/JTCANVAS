import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import { useAuthStore } from "@/stores/use-auth-store";
import { applyDefaultImageModel, useConfigStore } from "@/stores/use-config-store";
import { useModelStore } from "@/stores/use-model-store";

/**
 * Boots the session and the model catalogue once per page load.
 *
 * This used to accept `?baseUrl=` / `?apiKey=` query parameters to seed a provider channel. That
 * capability is gone: credentials are server-side and admin-managed, so a URL can no longer inject one.
 */
export function ClientRootInit({ children }: { children: ReactNode }) {
    const bootstrap = useAuthStore((state) => state.bootstrap);
    const user = useAuthStore((state) => state.user);
    const loadModels = useModelStore((state) => state.load);
    const resetModels = useModelStore((state) => state.reset);
    const previousUserId = useRef<string | null>(null);

    useEffect(() => {
        void bootstrap();
    }, [bootstrap]);

    useEffect(() => {
        if (!user) {
            resetModels();
            const hadUser = previousUserId.current !== null;
            previousUserId.current = null;
            if (hadUser) void import("@/stores/use-asset-store").then(({ useAssetStore }) => {
                if (previousUserId.current === null) useAssetStore.getState().reset();
            });
            return;
        }
        const priorUserId = previousUserId.current;
        previousUserId.current = user.id;
        void import("@/stores/use-asset-store").then(({ useAssetStore }) => {
            if (previousUserId.current !== user.id) return;
            const store = useAssetStore.getState();
            if (priorUserId && priorUserId !== user.id) store.reset();
            return store.loadAssets().catch(() => undefined);
        });
        let cancelled = false;
        const run = () => {
            void loadModels().then(() => {
                if (!cancelled) applyDefaultImageModel();
            });
        };
        if (useConfigStore.persist.hasHydrated()) {
            run();
            return () => {
                cancelled = true;
            };
        }
        const unsub = useConfigStore.persist.onFinishHydration(run);
        return () => {
            cancelled = true;
            unsub();
        };
    }, [loadModels, resetModels, user]);

    return <>{children}</>;
}
