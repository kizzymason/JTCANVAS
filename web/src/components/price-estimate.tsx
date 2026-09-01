import { Tooltip } from "antd";
import { Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { canAfford, estimateLocally, formatMoney } from "@/services/api/models";
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
    className?: string;
};

/**
 * Live cost hint shown next to every Generate button.
 *
 * Computed locally from the cached price table so it updates as the user changes size or count without
 * a request per keystroke; the server recalculates the authoritative amount when the task is submitted.
 */
export function PriceEstimate({ model, count, seconds, spec, referenceCount, className }: PriceEstimateProps) {
    const { t } = useTranslation();
    const found = useModelStore((state) => state.models.find((item) => item.value === model));
    const balance = useAuthStore((state) => state.user?.wallet.balance);
    const openAccountDrawer = useAccountDrawerStore((state) => state.open);

    const amount = estimateLocally(found, { count, seconds, spec, referenceCount });
    if (!amount) return null;

    const affordable = canAfford(balance, amount);

    return (
        <Tooltip title={affordable ? t("pricing.estimateTooltip", { balance: formatMoney(balance) }) : t("pricing.insufficientTooltip", { balance: formatMoney(balance) })}>
            <span className={cn("inline-flex items-center gap-1 text-xs", affordable ? "text-stone-500" : "text-red-500", className)}>
                <Zap className="size-3.5" />
                <span>
                    {t("pricing.estimate")} ¥{amount}
                </span>
                {affordable ? null : (
                    <button type="button" className="underline" onClick={openAccountDrawer}>
                        {t("pricing.topUp")}
                    </button>
                )}
            </span>
        </Tooltip>
    );
}

/** Whether the wallet covers the current selection; used to disable the Generate button. */
export function useCanAffordGeneration(model: string, input: { count?: number; seconds?: number; spec?: string; referenceCount?: number }) {
    const found = useModelStore((state) => state.models.find((item) => item.value === model));
    const balance = useAuthStore((state) => state.user?.wallet.balance);
    const amount = estimateLocally(found, input);
    return { amount, affordable: canAfford(balance, amount) };
}
