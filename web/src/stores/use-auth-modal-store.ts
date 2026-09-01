import { create } from "zustand";

import { useAuthStore } from "@/stores/use-auth-store";

export type AuthModalMode = "login" | "register";

const DEFAULT_REDIRECT = "/canvas";

type AuthModalStore = {
    open: boolean;
    mode: AuthModalMode;
    redirectTo: string;
    openModal: (options?: { mode?: AuthModalMode; redirectTo?: string }) => void;
    closeModal: () => void;
    setMode: (mode: AuthModalMode) => void;
};

export function sanitizeAuthRedirect(path?: string): string {
    if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/login")) {
        return DEFAULT_REDIRECT;
    }
    return path;
}

export const useAuthModalStore = create<AuthModalStore>((set) => ({
    open: false,
    mode: "login",
    redirectTo: DEFAULT_REDIRECT,
    openModal: (options) =>
        set({
            open: true,
            mode: options?.mode ?? "login",
            redirectTo: sanitizeAuthRedirect(options?.redirectTo),
        }),
    closeModal: () => set({ open: false, mode: "login" }),
    setMode: (mode) => set({ mode }),
}));

/** Opens the login modal when the visitor is signed out. Returns true if navigation should stop. */
export function requireAuth(redirectTo?: string): boolean {
    if (useAuthStore.getState().user) return false;
    useAuthModalStore.getState().openModal({ redirectTo });
    return true;
}
