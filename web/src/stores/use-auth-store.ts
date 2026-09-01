import { create } from "zustand";

import { fetchBootstrap, fetchWallet, login as loginRequest, logout as logoutRequest, register as registerRequest, type CurrentUser, type SiteInfo } from "@/services/api/account";
import { setUnauthorizedHandler } from "@/services/api/client";

type AuthStore = {
    /** False until the first bootstrap call settles; guards must wait for this. */
    ready: boolean;
    user: CurrentUser | null;
    site: SiteInfo;
    bootstrap: () => Promise<void>;
    login: (username: string, password: string) => Promise<void>;
    register: (username: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    /** Refreshes the cached balance after a generation or a top-up. */
    refreshWallet: () => Promise<void>;
    setUser: (user: CurrentUser | null) => void;
    setSite: (site: Partial<SiteInfo>) => void;
    isAdmin: () => boolean;
};

const DEFAULT_SITE: SiteInfo = { siteName: "景甜Canvas AI创作画布", registrationEnabled: true, rechargeNotice: "", imageGenerationEnabled: true, videoGenerationEnabled: true, agentEnabled: true };

export const useAuthStore = create<AuthStore>()((set, get) => ({
    ready: false,
    user: null,
    site: DEFAULT_SITE,

    bootstrap: async () => {
        try {
            const result = await fetchBootstrap();
            set({ user: result.user, site: result.site, ready: true });
        } catch {
            // A failed bootstrap must not leave the app stuck on a loading screen.
            set({ user: null, ready: true });
        }
    },

    login: async (username, password) => {
        const result = await loginRequest({ username, password });
        set({ user: result.user });
    },

    register: async (username, password) => {
        const result = await registerRequest({ username, password });
        set({ user: result.user });
    },

    logout: async () => {
        await logoutRequest().catch(() => undefined);
        set({ user: null });
    },

    refreshWallet: async () => {
        const current = get().user;
        if (!current) return;
        const wallet = await fetchWallet().catch(() => null);
        if (wallet) set({ user: { ...current, wallet } });
    },

    setUser: (user) => set({ user }),

    setSite: (site) => set((state) => ({ site: { ...state.site, ...site } })),

    isAdmin: () => get().user?.role === "admin",
}));

// A revoked or expired session anywhere in the app drops straight back to the login page.
setUnauthorizedHandler(() => {
    if (useAuthStore.getState().user) useAuthStore.setState({ user: null });
});
