import { Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { canAfford, estimateLocally } from "@/services/api/models";
import { useAccountDrawerStore } from "@/stores/use-account-drawer-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { useModelStore } from "@/stores/use-model-store";

type PriceEstimateProps = {
    model: string;
    count?: number;
    seconds?: number;
    /** Size/quality tier used to pick a differentiated price, e.g. "1K" or "2K". */
    spec?: string;
    referenceCount?: number;
    taskCount?: number;
    className?: string;
};

/**
 * Live cost hint shown next to every Generate button.
 *
 * Computed locally from the cached price table so it updates as the user changes size or count without
 * a request per keystroke; the server recalculates the authoritative amount when the task is submitted.
 */
export function PriceEstimate({ model, count, seconds, spec, referenceCount, taskCount, className }: PriceEstimateProps) {
    const { t } = useTranslation();
    const found = useModelStore((state) => state.models.find((item) => item.value === model));
    const openAccountDrawer = useAccountDrawerStore((state) => state.open);

    const amount = estimateLocally(found, { count, seconds, spec, referenceCount, taskCount });
    if (!amount) return null;

    return (
        <span className={cn("inline-flex max-w-full flex-col items-end gap-0.5 text-xs text-foreground", className)}>
            <span className="inline-flex items-center gap-1">
                <Zap className="size-3.5" />
                <span>
                    {t("pricing.estimate")} ¥{amount}
                </span>
                <button type="button" className="underline" onClick={openAccountDrawer}>
                    {t("pricing.topUp")}
                </button>
            </span>
        </span>
    );
}

/** Whether the wallet covers the current selection; used to disable the Generate button. */
export function useCanAffordGeneration(model: string, input: { count?: number; seconds?: number; spec?: string; referenceCount?: number; taskCount?: number }) {
    const found = useModelStore((state) => state.models.find((item) => item.value === model));
    const balance = useAuthStore((state) => state.user?.wallet.balance);
    const amount = estimateLocally(found, input);
    return { amount, affordable: canAfford(balance, amount) };
}
