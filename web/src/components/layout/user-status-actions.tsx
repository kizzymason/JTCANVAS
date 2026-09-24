import type { CSSProperties } from "react";
import { Tooltip } from "antd";
import { FileText, Keyboard, Puzzle, Settings2, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatMoney } from "@/lib/format-money";
import { useAccountDrawerStore } from "@/stores/use-account-drawer-store";
import { useAnnouncementStore } from "@/stores/use-announcement-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { requireAuth } from "@/stores/use-auth-modal-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useFrontendThemeStore } from "@/stores/use-frontend-theme-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    showAnnouncements?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ showConfig = true, showAnnouncements = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const { t } = useTranslation();
    const theme = useFrontendThemeStore((state) => state.theme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const openAccountDrawer = useAccountDrawerStore((state) => state.open);
    const openAnnouncements = useAnnouncementStore((state) => state.openList);
    const user = useAuthStore((state) => state.user);
    const canvasTheme = canvasThemes[theme];
    const compact = variant === "canvas";
    const naturalIconClass = `inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white ${compact ? "size-7 [&_svg]:size-4" : "size-9 [&_svg]:size-5"}`;
    const iconStyle: CSSProperties | undefined = compact ? { color: canvasTheme.node.text } : undefined;

    return (
        <div className={`inline-flex shrink-0 items-center ${compact ? "gap-1" : "gap-1.5"}`}>
            {onOpenPlugins ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenPlugins} aria-label={t("topNav.plugins")} title={t("topNav.plugins")}>
                    <Puzzle />
                </button>
            ) : null}
            {user ? (
                <Tooltip title={t("account.balanceTooltip", { balance: formatMoney(user.wallet.balance) })} mouseEnterDelay={0.2}>
                    <button
                        type="button"
                        className={`${naturalIconClass} lg:w-auto lg:gap-1.5 lg:px-2 lg:font-medium ${compact ? "lg:text-xs" : "lg:text-sm"}`}
                        style={iconStyle}
                        onClick={openAccountDrawer}
                        aria-label={t("account.balanceTooltip", { balance: formatMoney(user.wallet.balance) })}
                    >
                        <Wallet />
                        <span className="hidden lg:inline">¥{formatMoney(user.wallet.balance)}</span>
                    </button>
                </Tooltip>
            ) : (
                <button
                    type="button"
                    className={`${naturalIconClass} w-auto px-2.5 text-sm font-medium`}
                    onClick={() => requireAuth("/canvas")}
                    aria-label={t("auth.login")}
                >
                    {t("auth.login")}
                </button>
            )}
            {showConfig && user ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label={t("config.title")} title={t("config.title")}>
                    <Settings2 />
                </button>
            ) : null}
            {showAnnouncements ? <button type="button" className={naturalIconClass} style={iconStyle} onClick={openAnnouncements} aria-label={t("announcements.open")} title={t("announcements.open")}><FileText /></button> : null}
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label={t("topNav.shortcuts")} title={t("topNav.shortcuts")}>
                    <Keyboard />
                </button>
            ) : null}
        </div>
    );
}
