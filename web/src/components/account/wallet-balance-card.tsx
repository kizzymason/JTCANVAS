import { useTranslation } from "react-i18next";

import { formatMoney } from "@/services/api/models";
import { useAuthStore } from "@/stores/use-auth-store";

export function WalletBalanceCard({ onRecharge, onWithdraw }: { onRecharge: () => void; onWithdraw: () => void }) {
    const { t } = useTranslation();
    const user = useAuthStore((state) => state.user);
    const siteName = useAuthStore((state) => state.site.siteName);

    return (
        <div className="group relative mb-5 w-full overflow-hidden rounded-xl border border-white/10 bg-black text-white shadow-[0_16px_36px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.16)] transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-px hover:shadow-[0_18px_38px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.2)] dark:border-black/10 dark:bg-white dark:text-black dark:shadow-[0_16px_36px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.95)] dark:hover:shadow-[0_22px_48px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,1)]">
            <span aria-hidden className="pointer-events-none absolute inset-px rounded-[inherit] border border-white/10 dark:border-black/10" />
            <span
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-[0.11] mix-blend-overlay dark:opacity-[0.18] dark:mix-blend-multiply"
                style={{
                    backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.16) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px)",
                    backgroundSize: "22px 22px",
                }}
            />
            <span aria-hidden className="pointer-events-none absolute -left-1/3 top-0 h-full w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-0 transition-all duration-500 group-hover:left-1/2 group-hover:opacity-100 dark:via-black/5" />
            <div className="relative z-10 flex flex-col gap-2.5 px-4 py-3.5">
                <div className="flex items-center justify-between gap-3">
                    <span aria-hidden className="relative h-6 w-8 overflow-hidden rounded-[4px] border border-white/25 bg-[linear-gradient(160deg,#d4d4d4_0%,#8a8a8a_42%,#f5f5f5_100%)] dark:border-black/15 dark:bg-[linear-gradient(160deg,#737373_0%,#a3a3a3_48%,#525252_100%)]">
                        <span className="absolute inset-x-0.5 top-1/3 h-px bg-black/25" />
                        <span className="absolute inset-x-0.5 top-2/3 h-px bg-black/25" />
                        <span className="absolute inset-y-0.5 left-1/3 w-px bg-black/25" />
                        <span className="absolute inset-y-0.5 left-2/3 w-px bg-black/25" />
                    </span>
                    <span className="max-w-[55%] truncate text-[10px] font-medium tracking-[0.18em] text-white/50 uppercase dark:text-neutral-500">{siteName}</span>
                </div>

                <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[11px] tracking-wide text-white/50 dark:text-neutral-500">{t("account.walletBalance")}</p>
                        <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums">¥{formatMoney(user?.wallet.balance)}</p>
                    </div>
                    <p className="mb-0.5 shrink-0 text-[10px] tracking-[0.16em] text-white/40 uppercase dark:text-neutral-500">CNY</p>
                </div>

                <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-xs tracking-wide text-white/70 dark:text-neutral-600">{user?.username}</p>
                    <div className="flex shrink-0 gap-1.5">
                        <button
                            type="button"
                            onClick={onRecharge}
                            className="rounded-md bg-white px-3 py-1.5 text-xs font-medium !text-black transition hover:bg-white/90 dark:bg-black dark:!text-white dark:hover:bg-neutral-800"
                        >
                            {t("account.recharge")}
                        </button>
                        <button
                            type="button"
                            onClick={onWithdraw}
                            className="rounded-md border border-white/30 px-3 py-1.5 text-xs font-medium !text-white transition hover:bg-white/10 dark:border-black/20 dark:!text-neutral-900 dark:hover:bg-black/5"
                        >
                            {t("account.withdraw")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
