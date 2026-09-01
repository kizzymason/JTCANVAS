import { Tooltip } from "antd";
import { Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { hasVideoInputPricing, videoPricingSpecFor } from "@/lib/video-pricing-spec";
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
    const dualVideo = found?.billingMode === "per_second" && hasVideoInputPricing(found.specPrices);
    const withoutVideo = dualVideo ? estimateLocally(found, { seconds: 1, spec: videoPricingSpecFor(spec?.replace(/-video$/, ""), false) }) : "";
    const withVideo = dualVideo ? estimateLocally(found, { seconds: 1, spec: videoPricingSpecFor(spec?.replace(/-video$/, ""), true) }) : "";
    const rateHint = dualVideo && withoutVideo && withVideo ? t("pricing.videoRateHint", { without: withoutVideo, with: withVideo }) : "";

    return (
        <Tooltip
            title={
                <span className="flex flex-col gap-1">
                    <span>{affordable ? t("pricing.estimateTooltip", { balance: formatMoney(balance) }) : t("pricing.insufficientTooltip", { balance: formatMoney(balance) })}</span>
                    {rateHint ? <span>{rateHint}</span> : null}
                </span>
            }
        >
            <span className={cn("inline-flex max-w-full flex-col items-end gap-0.5 text-xs", affordable ? "text-stone-500" : "text-red-500", className)}>
                <span className="inline-flex items-center gap-1">
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
                {rateHint ? <span className="max-w-[220px] text-right text-[10px] leading-tight opacity-80">{rateHint}</span> : null}
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
