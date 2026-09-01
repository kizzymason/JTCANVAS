import { useTranslation } from "react-i18next";

import { InvertedSurface } from "@/components/inverted-surface";
import { formatMoney } from "@/services/api/models";
import { useAuthStore } from "@/stores/use-auth-store";

export function WalletBalanceCard({ onRecharge, onWithdraw }: { onRecharge: () => void; onWithdraw: () => void }) {
    const { t } = useTranslation();
    const user = useAuthStore((state) => state.user);
    const siteName = useAuthStore((state) => state.site.siteName);

    return (
        <InvertedSurface className="mb-5 w-full rounded-xl" innerClassName="flex flex-col gap-2.5 px-4 py-3.5">
            <div className="flex items-center justify-between gap-3">
                <span aria-hidden className="relative h-6 w-8 overflow-hidden rounded-[4px] border border-white/25 bg-[linear-gradient(160deg,#d4d4d4_0%,#8a8a8a_42%,#f5f5f5_100%)] dark:border-black/15 dark:bg-[linear-gradient(160deg,#737373_0%,#a3a3a3_48%,#525252_100%)]">
                    <span className="absolute inset-x-0.5 top-1/3 h-px bg-black/25" />
                    <span className="absolute inset-x-0.5 top-2/3 h-px bg-black/25" />
                    <span className="absolute inset-y-0.5 left-1/3 w-px bg-black/25" />
                    <span className="absolute inset-y-0.5 left-2/3 w-px bg-black/25" />
                </span>
                <span className="max-w-[55%] truncate text-[10px] font-medium tracking-[0.18em] text-white/50 uppercase dark:text-stone-500">{siteName}</span>
            </div>

            <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[11px] tracking-wide text-white/50 dark:text-stone-500">{t("account.walletBalance")}</p>
                    <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums">¥{formatMoney(user?.wallet.balance)}</p>
                </div>
                <p className="mb-0.5 shrink-0 text-[10px] tracking-[0.16em] text-white/40 uppercase dark:text-stone-400">CNY</p>
            </div>

            <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-xs tracking-wide text-white/70 dark:text-stone-600">{user?.username}</p>
                <div className="flex shrink-0 gap-1.5">
                    <button
                        type="button"
                        onClick={onRecharge}
                        className="rounded-md bg-white px-3 py-1 text-xs font-medium !text-black transition hover:bg-white/90 dark:bg-neutral-900 dark:!text-white dark:hover:bg-neutral-800"
                    >
                        {t("account.recharge")}
                    </button>
                    <button
                        type="button"
                        onClick={onWithdraw}
                        className="rounded-md border border-white/30 px-3 py-1 text-xs font-medium !text-white transition hover:bg-white/10 dark:border-black/20 dark:!text-neutral-900 dark:hover:bg-black/5"
                    >
                        {t("account.withdraw")}
                    </button>
                </div>
            </div>
        </InvertedSurface>
    );
}
