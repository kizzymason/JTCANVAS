import { Alert, App, Button, Input, InputNumber, Spin, Tag, Typography } from "antd";
import { ArrowRight, Copy, CreditCard, Mail, ShieldCheck, Ticket } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { SegmentedSwitch } from "@/components/ui/segmented-switch";
import { useAntiInspect } from "@/hooks/use-anti-inspect";
import { useCopyText } from "@/hooks/use-copy-text";
import { cardShopApi, rememberOrderToken, type CardCheckout, type CardOrder, type CardPaymentMethod, type CardProduct, type CardShopCatalog } from "@/services/api/card-shop";
import { ApiError } from "@/services/api/client";
import { formatMoney } from "@/services/api/models";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 150;

/**
 * Standalone card storefront for private-channel customers.
 *
 * Reached by direct link only — it is deliberately absent from the site navigation — and needs no
 * account: the purchase hands over redeem codes, and the buyer credits their own wallet later.
 */
export default function CardShopPage() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    useAntiInspect();
    const [catalog, setCatalog] = useState<CardShopCatalog | null>(null);
    const [loading, setLoading] = useState(true);
    const [productId, setProductId] = useState<string>();
    const [quantity, setQuantity] = useState(1);
    const [email, setEmail] = useState("");
    const [method, setMethod] = useState<CardPaymentMethod>("alipay");
    const [submitting, setSubmitting] = useState(false);
    const [checkout, setCheckout] = useState<CardCheckout | null>(null);
    const [paid, setPaid] = useState<CardOrder | null>(null);
    const pollRef = useRef<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        void cardShopApi
            .catalog()
            .then((result) => {
                if (cancelled) return;
                setCatalog(result);
                setProductId(result.items.find((item) => item.stock > 0)?.id ?? result.items[0]?.id);
                if (result.methods[0]) setMethod(result.methods[0].method);
            })
            .catch(() => undefined)
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // The gateway settles out of band, so the page polls its own order until the codes appear.
    useEffect(() => {
        if (!checkout?.orderNo) return;
        let attempts = 0;
        const tick = async () => {
            attempts += 1;
            try {
                const order = await cardShopApi.order(checkout.orderNo, checkout.accessToken);
                if (order.status === "paid") {
                    setPaid(order);
                    return;
                }
            } catch {
                // A notification or the next poll may still settle it.
            }
            if (attempts >= POLL_MAX_ATTEMPTS) return;
            pollRef.current = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
        };
        pollRef.current = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
        return () => {
            if (pollRef.current) window.clearTimeout(pollRef.current);
        };
    }, [checkout]);

    const selected = catalog?.items.find((item) => item.id === productId);
    const total = selected ? formatMoney(String(Number(selected.salePrice) * quantity)) : "0.00";

    const submit = useCallback(async () => {
        if (!selected) return;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            message.error(t("cardShop.emailInvalid"));
            return;
        }
        setSubmitting(true);
        try {
            const channelId = catalog?.methods.find((item) => item.method === method)?.channelId;
            const created = await cardShopApi.createOrder({ productId: selected.id, quantity, email: email.trim(), method, channelId });
            // Persisted before the buyer leaves for the cashier, so coming back can still show codes.
            rememberOrderToken(created.orderNo, created.accessToken);
            setCheckout(created);
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("cardShop.orderFailed"));
        } finally {
            setSubmitting(false);
        }
    }, [catalog, email, message, method, quantity, selected, t]);

    return (
        <main className="h-dvh overflow-y-auto bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-10 sm:px-6 sm:py-14">
                <header className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-stone-950 dark:text-stone-100">
                        <Ticket className="size-6" />
                        <span className="text-lg font-semibold tracking-tight">{t("cardShop.title")}</span>
                    </div>
                    <p className="text-sm text-stone-500">{t("cardShop.subtitle")}</p>
                    <Link to="/cards/orders" className="inline-flex w-fit items-center gap-1.5 text-sm text-stone-600 underline hover:text-stone-950 dark:text-stone-300 dark:hover:text-stone-100">
                        {t("cardShop.lookupLink")}
                        <ArrowRight className="size-3.5" />
                    </Link>
                </header>

                {loading ? (
                    <div className="flex min-h-[240px] items-center justify-center">
                        <Spin />
                    </div>
                ) : paid ? (
                    <PaidPanel order={paid} />
                ) : checkout ? (
                    <CheckoutPanel checkout={checkout} onBack={() => setCheckout(null)} />
                ) : !catalog?.available ? (
                    <Alert type="info" showIcon message={t("cardShop.unavailableTitle")} description={t("cardShop.unavailableHint")} />
                ) : (
                    <>
                        <section className="flex flex-col gap-3">
                            <h2 className="text-sm font-semibold text-stone-950 dark:text-stone-100">{t("cardShop.pickProduct")}</h2>
                            <div className="grid gap-3 sm:grid-cols-2">
                                {catalog.items.map((item) => (
                                    <ProductCard key={item.id} product={item} selected={item.id === productId} onSelect={() => setProductId(item.id)} />
                                ))}
                            </div>
                        </section>

                        <section className="flex flex-col gap-4 rounded-lg border border-stone-200 p-5 dark:border-stone-800">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <label className="flex flex-col gap-1.5">
                                    <span className="text-xs font-medium text-stone-500">{t("cardShop.quantity")}</span>
                                    <InputNumber min={1} max={Math.max(1, Math.min(selected?.perOrderLimit ?? 1, selected?.stock ?? 1))} value={quantity} onChange={(value) => setQuantity(Math.max(1, Math.floor(Number(value) || 1)))} className="w-full" />
                                    {selected ? <span className="text-xs text-stone-500">{t("cardShop.quantityHint", { limit: selected.perOrderLimit, stock: selected.stock })}</span> : null}
                                </label>
                                <label className="flex flex-col gap-1.5">
                                    <span className="text-xs font-medium text-stone-500">{t("cardShop.email")}</span>
                                    <Input prefix={<Mail className="size-3.5 opacity-60" />} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" maxLength={160} />
                                    <span className="text-xs text-stone-500">{t("cardShop.emailHint")}</span>
                                </label>
                            </div>

                            {catalog.methods.length > 1 ? (
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-xs font-medium text-stone-500">{t("cardShop.method")}</span>
                                    <SegmentedSwitch value={method} onChange={setMethod} items={catalog.methods.map((item) => ({ value: item.method, label: item.label }))} />
                                </div>
                            ) : null}

                            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
                                <div className="text-sm">
                                    <span className="text-stone-500">{t("cardShop.total")}</span>
                                    <span className="ml-2 text-xl font-semibold tabular-nums text-stone-950 dark:text-stone-100">{`¥${total}`}</span>
                                </div>
                                <Button type="primary" size="large" icon={<CreditCard className="size-4" />} loading={submitting} disabled={!selected || selected.stock < 1} onClick={() => void submit()}>
                                    {t("cardShop.pay")}
                                </Button>
                            </div>
                        </section>

                        <p className="flex items-start gap-2 text-xs text-stone-500">
                            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                            {t("cardShop.notice")}
                        </p>
                    </>
                )}
            </div>
        </main>
    );
}

function ProductCard({ product, selected, onSelect }: { product: CardProduct; selected: boolean; onSelect: () => void }) {
    const { t } = useTranslation();
    const soldOut = product.stock < 1;
    return (
        <button
            type="button"
            onClick={onSelect}
            disabled={soldOut}
            className={cn(
                "flex flex-col gap-1 rounded-lg border p-4 text-left transition",
                selected ? "border-primary bg-accent text-primary" : "border-border bg-card hover:border-primary/50",
                soldOut && "cursor-not-allowed opacity-55",
            )}
        >
            <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-stone-950 dark:text-stone-100">{product.name}</span>
                {soldOut ? <Tag color="default">{t("cardShop.soldOut")}</Tag> : <Tag color="green">{t("cardShop.inStock", { count: product.stock })}</Tag>}
            </div>
            <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold tabular-nums text-stone-950 dark:text-stone-100">{`¥${formatMoney(product.salePrice)}`}</span>
                <span className="text-xs text-stone-500">{t("cardShop.faceValue", { amount: formatMoney(product.faceValue) })}</span>
            </div>
            {product.description ? <p className="text-xs text-stone-500">{product.description}</p> : null}
        </button>
    );
}

function CheckoutPanel({ checkout, onBack }: { checkout: CardCheckout; onBack: () => void }) {
    const { t } = useTranslation();
    const qrSrc = checkout.img || (checkout.qrcode.startsWith("http") && /\.(png|jpg|jpeg|gif|webp)(\?|$)/i.test(checkout.qrcode) ? checkout.qrcode : "");
    return (
        <section className="flex flex-col items-center gap-3 rounded-lg border border-stone-200 p-6 text-center dark:border-stone-800">
            <p className="text-sm font-medium text-stone-950 dark:text-stone-100">{t("cardShop.waitingPayment")}</p>
            <p className="text-xs text-stone-500">{t("cardShop.waitingHint", { amount: formatMoney(checkout.amount), count: checkout.quantity })}</p>
            {qrSrc ? <img src={qrSrc} alt={t("cardShop.scanQr")} className="size-48 rounded-md bg-white p-2" /> : null}
            <Button type="primary" href={checkout.payUrl} target="_blank" rel="noreferrer">
                {t("cardShop.openCashier")}
            </Button>
            <p className="text-xs text-stone-500">{t("cardShop.orderNo", { orderNo: checkout.orderNo })}</p>
            <Button type="text" onClick={onBack}>
                {t("cardShop.chooseAgain")}
            </Button>
        </section>
    );
}

/** Codes are shown inline and remain retrievable from the look-up page with the same e-mail. */
export function CardCodeList({ order }: { order: CardOrder }) {
    const { t } = useTranslation();
    const copy = useCopyText();
    const allCodes = order.codes.join("\n");
    return (
        // `data-allow-copy` opts these out of the context-menu and selection blocking: a buyer who
        // cannot copy a code has not received what they paid for.
        <div className="flex flex-col gap-2" data-allow-copy>
            {order.codes.map((code) => (
                <div key={code} className="flex items-center justify-between gap-2 rounded border border-stone-200 px-3 py-2 dark:border-stone-800">
                    <span className="select-all break-all font-mono text-sm">{code}</span>
                    <Button size="small" type="text" icon={<Copy className="size-3.5" />} onClick={() => copy(code)} />
                </div>
            ))}
            {order.codes.length > 1 ? (
                <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => copy(allCodes)}>
                    {t("cardShop.copyAll")}
                </Button>
            ) : null}
        </div>
    );
}

function PaidPanel({ order }: { order: CardOrder }) {
    const { t } = useTranslation();
    const short = order.deliveredCount < order.quantity;
    return (
        <section className="flex flex-col gap-4">
            <Alert type="success" showIcon message={t("cardShop.paidTitle")} description={t("cardShop.paidHint")} />
            {short ? <Alert type="warning" showIcon message={t("cardShop.shortTitle")} description={t("cardShop.shortHint", { delivered: order.deliveredCount, quantity: order.quantity })} /> : null}
            <div className="rounded-lg border border-stone-200 p-5 dark:border-stone-800">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-stone-950 dark:text-stone-100">{order.productName}</span>
                    <Typography.Text copyable={{ text: order.orderNo }} className="!text-xs">
                        {order.orderNo}
                    </Typography.Text>
                </div>
                <CardCodeList order={order} />
                <p className="mt-3 text-xs text-stone-500">{t("cardShop.redeemHint")}</p>
            </div>
            <Link to="/cards/orders" className="text-sm text-stone-600 underline hover:text-stone-950 dark:text-stone-300 dark:hover:text-stone-100">
                {t("cardShop.lookupLink")}
            </Link>
        </section>
    );
}
