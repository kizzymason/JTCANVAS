import { Drawer } from "antd";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { visibleNavigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { useSiteServices } from "@/hooks/use-site-services";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/use-auth-store";
import { requireAuth } from "@/stores/use-auth-modal-store";

type MobileNavDrawerProps = {
    open: boolean;
    activeToolSlug?: NavigationToolSlug;
    onClose: () => void;
};

export function MobileNavDrawer({ open, activeToolSlug, onClose }: MobileNavDrawerProps) {
    const { t } = useTranslation();
    const services = useSiteServices();
    const user = useAuthStore((state) => state.user);
    const tools = visibleNavigationTools(services);

    return (
        <Drawer title={t("topNav.navigation")} placement="left" size={280} open={open} onClose={onClose} className="md:hidden">
            <div className="space-y-1">
                {tools.map((tool) => {
                    const active = tool.slug === activeToolSlug;
                    return (
                        <Link
                            key={tool.slug}
                            to={tool.path}
                            onClick={(event) => {
                                if (!user && requireAuth(tool.path)) {
                                    event.preventDefault();
                                    onClose();
                                    return;
                                }
                                onClose();
                            }}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-3.5 text-lg transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                                active ? "bg-stone-100 font-medium text-stone-950 dark:bg-stone-800 dark:text-stone-100" : "text-stone-600 hover:bg-stone-100/80 hover:text-stone-800 dark:text-stone-300 dark:hover:bg-stone-800/80 dark:hover:text-stone-100",
                            )}
                        >
                            <img src={tool.icon} alt="" aria-hidden className="size-7 shrink-0 object-contain" draggable={false} />
                            <span>{t(`navigation.${tool.slug}`)}</span>
                        </Link>
                    );
                })}
            </div>
        </Drawer>
    );
}
