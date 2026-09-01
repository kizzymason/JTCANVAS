import type { ReactNode } from "react";
import { useEffect } from "react";

import { useAuthStore } from "@/stores/use-auth-store";
import { useAssetStore } from "@/stores/use-asset-store";
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
    const loadAssets = useAssetStore((state) => state.loadAssets);
    const resetAssets = useAssetStore((state) => state.reset);

    useEffect(() => {
        void bootstrap();
    }, [bootstrap]);

    useEffect(() => {
        if (!user) {
            resetModels();
            resetAssets();
            return;
        }
        void loadAssets().catch(() => undefined);
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
    }, [loadAssets, loadModels, resetAssets, resetModels, user]);

    return <>{children}</>;
}
