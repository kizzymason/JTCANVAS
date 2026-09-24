import { create } from "zustand";
import { persist } from "zustand/middleware";

export type FrontendTheme = "light" | "dark";
export const FRONTEND_THEME_STORAGE_KEY = "jtcanvas:frontend-theme-store";

type FrontendThemeStore = {
    theme: FrontendTheme;
    setTheme: (theme: FrontendTheme) => void;
};

/** Frontend appearance is a local view preference and is deliberately separate from the admin theme. */
export const useFrontendThemeStore = create<FrontendThemeStore>()(
    persist(
        (set) => ({
            theme: "dark",
            setTheme: (theme) => set({ theme }),
        }),
        { name: FRONTEND_THEME_STORAGE_KEY },
    ),
);
