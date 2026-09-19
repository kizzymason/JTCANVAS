import { Alert, App, Button, Empty, Input, Spin, Tag, Typography } from "antd";
import { ArrowLeft, Mail, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { useAntiInspect } from "@/hooks/use-anti-inspect";
import { cardShopApi, recallOrderToken, type CardOrder } from "@/services/api/card-shop";
import { ApiError } from "@/services/api/client";
import { formatMoney } from "@/services/api/models";
import { CardCodeList } from "./index";

const STATUS_COLOR: Record<CardOrder["status"], string> = { paid: "green", pending: "orange", failed: "red", cancelled: "default" };
/** Remembered locally so a returning buyer does not retype it; it is not a credential worth hiding. */
const EMAIL_STORAGE_KEY = "jt.cardShop.email";

/**
 * Order look-up for guest buyers. The e-mail from checkout is the only handle they have, so it is
 * what this page searches on — there is no account to log into.
 */
export default function CardOrdersPage() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    useAntiInspect();
    const [params] = useSearchParams();
    const [email, setEmail] = useState(() => localStorage.getItem(EMAIL_STORAGE_KEY) ?? "");
    const [orders, setOrders] = useState<CardOrder[] | null>(null);
    const [single, setSingle] = useState<CardOrder | null>(null);
    const [loading, setLoading] = useState(false);

    const orderNo = params.get("order") ?? "";

    // Coming back from the cashier: the order number is in the URL and the token is in localStorage
    // from checkout, so the codes can be shown without asking for the e-mail again.
    useEffect(() => {
        if (!orderNo) return;
        let cancelled = false;
        setLoading(true);
        void cardShopApi
            .order(orderNo, recallOrderToken(orderNo))
            .then((result) => !cancelled && setSingle(result))
            .catch(() => undefined)
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [orderNo]);

    const search = useCallback(async () => {
        const value = email.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            message.error(t("cardShop.emailInvalid"));
            return;
        }
        setLoading(true);
        try {
            const result = await cardShopApi.lookup({ email: value, page: 1, pageSize: 20 });
            setOrders(result.items);
            localStorage.setItem(EMAIL_STORAGE_KEY, value);
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("cardShop.lookupFailed"));
        } finally {
            setLoading(false);
        }
    }, [email, message, t]);

    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-10 sm:px-6 sm:py-14">
                <header className="flex flex-col gap-3">
                    <Link to="/cards" className="inline-flex w-fit items-center gap-1.5 text-sm text-stone-600 hover:text-stone-950 dark:text-stone-300 dark:hover:text-stone-100">
                        <ArrowLeft className="size-3.5" />
                        {t("cardShop.backToShop")}
                    </Link>
                    <h1 className="text-lg font-semibold tracking-tight text-stone-950 dark:text-stone-100">{t("cardShop.ordersTitle")}</h1>
                    <p className="text-sm text-stone-500">{t("cardShop.ordersSubtitle")}</p>
                </header>

                <div className="flex flex-wrap gap-2">
                    <Input prefix={<Mail className="size-3.5 opacity-60" />} value={email} onChange={(event) => setEmail(event.target.value)} onPressEnter={() => void search()} placeholder="you@example.com" maxLength={160} className="min-w-0 flex-1" />
                    <Button type="primary" icon={<Search className="size-4" />} loading={loading} onClick={() => void search()}>
                        {t("cardShop.lookup")}
                    </Button>
                </div>

                {loading && !orders && !single ? (
                    <div className="flex min-h-[160px] items-center justify-center">
                        <Spin />
                    </div>
                ) : null}

                {single ? <OrderCard order={single} highlight /> : null}

                {orders ? (
                    orders.length ? (
                        <div className="flex flex-col gap-3">
                            {orders.map((order) => (
                                <OrderCard key={order.orderNo} order={order} />
                            ))}
                        </div>
                    ) : (
                        <Empty description={t("cardShop.noOrders")} />
                    )
                ) : null}
            </div>
        </main>
    );
}

function OrderCard({ order, highlight }: { order: CardOrder; highlight?: boolean }) {
    const { t } = useTranslation();
    const short = order.status === "paid" && order.deliveredCount < order.quantity;
    return (
        <section className={`rounded-lg border p-4 ${highlight ? "border-stone-950 dark:border-stone-100" : "border-stone-200 dark:border-stone-800"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate font-medium text-stone-950 dark:text-stone-100">{order.productName}</div>
                    <Typography.Text copyable={{ text: order.orderNo }} className="!text-xs !text-stone-500">
                        {order.orderNo}
                    </Typography.Text>
                </div>
                <div className="flex items-center gap-2">
                    <Tag color={STATUS_COLOR[order.status]}>{t(`cardShop.statuses.${order.status}`)}</Tag>
                    <span className="text-sm tabular-nums text-stone-950 dark:text-stone-100">{`¥${formatMoney(order.amount)}`}</span>
                </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
                <span>{t("cardShop.orderQuantity", { count: order.quantity })}</span>
                <span>{t("cardShop.faceValue", { amount: formatMoney(order.faceValue) })}</span>
                <span>{new Date(order.createdAt).toLocaleString()}</span>
            </div>

            {short ? <Alert className="mt-3" type="warning" showIcon message={t("cardShop.shortHint", { delivered: order.deliveredCount, quantity: order.quantity })} /> : null}

            {order.status === "paid" && order.codesLocked ? (
                <Alert className="mt-3" type="info" showIcon message={t("cardShop.lockedTitle")} description={t("cardShop.lockedHint")} />
            ) : order.status === "paid" ? (
                <div className="mt-3">
                    <CardCodeList order={order} />
                    <p className="mt-2 text-xs text-stone-500">{t("cardShop.redeemHint")}</p>
                </div>
            ) : order.status === "pending" ? (
                <p className="mt-3 text-xs text-stone-500">{t("cardShop.pendingHint")}</p>
            ) : null}
        </section>
    );
}
