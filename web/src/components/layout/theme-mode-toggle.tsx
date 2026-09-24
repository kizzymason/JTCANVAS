import { Moon, Sun } from "lucide-react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useFrontendThemeStore } from "@/stores/use-frontend-theme-store";

export function ThemeModeToggle() {
    const { t } = useTranslation();
    const theme = useFrontendThemeStore((state) => state.theme);
    const setTheme = useFrontendThemeStore((state) => state.setTheme);
    const nextTheme = theme === "dark" ? "light" : "dark";
    const label = theme === "dark" ? t("theme.switchToLight") : t("theme.switchToDark");

    return (
        <Tooltip title={label}>
            <AnimatedThemeToggler
                aria-label={label}
                title={label}
                theme={theme}
                targetTheme={nextTheme}
                onThemeChange={setTheme}
                className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                duration={360}
                variant="circle"
            >
                {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
            </AnimatedThemeToggler>
        </Tooltip>
    );
}
