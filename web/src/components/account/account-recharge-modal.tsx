import { App, Button, Form, Input, Modal, Spin } from "antd";
import { Ticket, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { SegmentedSwitch } from "@/components/ui/segmented-switch";
import { createRecharge, fetchRechargeCatalog, fetchRechargeOrder, redeemCard, type RechargeCatalog, type RechargeCheckout, type RechargePackageOption } from "@/services/api/account";
import { ApiError, newIdempotencyKey } from "@/services/api/client";
import { QRCodeSVG } from "qrcode.react";
import { formatMoney } from "@/services/api/models";
import { useAuthStore } from "@/stores/use-auth-store";

type RechargeMode = "recharge" | "redeem";

/**
 * 手机点这个链接可以直接唤起支付宝扫一扫并打开收款码（上游收银台页面用的就是同一个 scheme）。
 * 静态收款码本身带不了金额，所以金额仍要在支付宝里输入——弹窗里提供了「复制金额」避免输错。
 */
function alipayScheme(qrContent: string) {
    return `alipays://platformapi/startapp?saId=10000007&clientVersion=3.7.0.0718&qrcode=${encodeURIComponent(qrContent)}`;
}

/**
 * Centered over the wallet drawer. Online top-up talks to the billed server; the gateway QR/cashier
 * stays in this modal while the client polls the order until it is paid.
 */
export function AccountRechargeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const [mode, setMode] = useState<RechargeMode>("recharge");

    return (
        <Modal
            title={t("account.recharge")}
            open={open}
            onCancel={onClose}
            footer={null}
            centered
            destroyOnHidden
            width={420}
            zIndex={2000}
            styles={{ container: { maxWidth: "calc(100vw - 32px)" } }}
            afterOpenChange={(next) => {
                if (!next) setMode("recharge");
            }}
        >
            <SegmentedSwitch
                className="mb-5"
                value={mode}
                onChange={setMode}
                items={[
                    { value: "recharge", label: t("account.recharge") },
                    { value: "redeem", label: t("account.redeemTab") },
                ]}
            />

            {mode === "recharge" ? <OnlineRechargeForm active={open} onSuccess={onClose} /> : <RedeemForm onSuccess={onClose} />}
        </Modal>
    );
}

function OnlineRechargeForm({ active, onSuccess }: { active: boolean; onSuccess: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const notice = useAuthStore((state) => state.site.rechargeNotice);
    const refreshWallet = useAuthStore((state) => state.refreshWallet);
    const [catalog, setCatalog] = useState<RechargeCatalog | null>(null);
    const [loading, setLoading] = useState(true);
    const [packageId, setPackageId] = useState<string>();
    const [customAmount, setCustomAmount] = useState("");
    const [channelId, setChannelId] = useState<string>();
    const [submitting, setSubmitting] = useState(false);
    const [checkout, setCheckout] = useState<RechargeCheckout | null>(null);
    const pollRef = useRef<number | null>(null);

    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        setLoading(true);
        setCheckout(null);
        void fetchRechargeCatalog()
            .then((result) => {
                if (cancelled) return;
                setCatalog(result);
                const firstChannel = result.channels[0]?.channelId;
                if (firstChannel) setChannelId(firstChannel);
                const firstPackage = result.packages[0]?.id;
                if (firstPackage) setPackageId(firstPackage);
            })
            .catch((error) => {
                if (!cancelled) message.error(error instanceof ApiError ? error.message : t("account.payFailed"));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [active, message, t]);

    useEffect(() => {
        if (!active || !checkout?.orderNo) return;
        let attempts = 0;
        let timer: number | null = null;
        const tick = async () => {
            attempts += 1;
            try {
                const order = await fetchRechargeOrder(checkout.orderNo);
                if (order.status === "paid") {
                    message.success(t("account.paidSuccess", { amount: formatMoney(order.creditAmount) }));
                    await refreshWallet();
                    onSuccess();
                    return;
                }
            } catch {
                // Notify or the next query may still settle the order.
            }
            if (attempts >= 150) {
                message.warning(t("account.payTimeout"));
                return;
            }
            timer = window.setTimeout(() => void tick(), 2000);
            pollRef.current = timer;
        };
        timer = window.setTimeout(() => void tick(), 2000);
        pollRef.current = timer;
        return () => {
            if (pollRef.current) window.clearTimeout(pollRef.current);
        };
    }, [active, checkout, message, onSuccess, refreshWallet, t]);

    if (loading) {
        return (
            <div className="flex justify-center py-10">
                <Spin />
            </div>
        );
    }

    if (!catalog?.available) {
        return (
            <div className="py-2">
                <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Wallet className="size-4" />
                    {t("account.onlineRecharge")}
                </p>
                <p className="text-sm text-stone-500">{catalog?.notice || notice || t("account.rechargeUnavailable")}</p>
            </div>
        );
    }

    if (checkout) {
        // 网关给的 qrcode 有两种形态：图片地址（易支付常见），以及「二维码内容」本身——
        // 码支付类渠道（云启）返回的就是支付宝收款码链接（如 https://qr.alipay.com/xxx），
        // 这种必须由前端自己画成二维码才能扫，直接塞进 img src 会是一张破图。
        const qrImage = checkout.img || (checkout.qrcode.startsWith("http") && /\.(png|jpg|jpeg|gif|webp)(\?|$)/i.test(checkout.qrcode) ? checkout.qrcode : "");
        const qrValue = qrImage ? "" : checkout.qrcode.trim();
        // 网关自己给了唤起链接（如景诺支付给的 alipays://platformapi/startapp?appId=20000067&url=<支付页>）就用它，
        // 否则按收款码内容拼一个（云启那种静态收款码）。
        const alipayLink = (checkout.urlscheme || "").trim() || (qrValue ? alipayScheme(qrValue) : "");
        return (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
                <p className="text-sm font-medium">{t("account.waitingPayment")}</p>
                {qrImage ? <img src={qrImage} alt={t("account.scanQr")} className="size-48 rounded-md bg-white p-2" /> : null}
                {qrValue ? (
                    <div className="rounded-md bg-white p-2" role="img" aria-label={t("account.scanQr")}>
                        <QRCodeSVG value={qrValue} size={176} level="M" />
                    </div>
                ) : null}
                {qrImage || qrValue ? (
                    <>
                        <div className="flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2 dark:border-stone-700">
                            <span className="text-xs text-stone-500">{t("account.amountToPay")}</span>
                            <span className="text-lg font-semibold tabular-nums">{formatMoney(checkout.amount)}</span>
                        </div>
                        <p className="text-xs text-stone-500">{t("account.payAmountHint", { paid: formatMoney(checkout.amount), credit: formatMoney(checkout.creditAmount) })}</p>
                        {alipayLink && checkout.method === "alipay" ? (
                            <Button type="link" size="small" href={alipayLink}>
                                {t("account.openInAlipay")}
                            </Button>
                        ) : null}
                    </>
                ) : (
                    <Button type="primary" href={checkout.payUrl} target="_blank" rel="noreferrer">
                        {t("account.openCashier")}
                    </Button>
                )}
                <Button type="text" onClick={() => setCheckout(null)}>
                    {t("account.chooseAgain")}
                </Button>
            </div>
        );
    }

    const selected = catalog.packages.find((item) => item.id === packageId);
    const usingCustom = catalog.allowCustomAmount && !packageId;

    const pay = async () => {
        const picked = catalog.channels.find((item) => item.channelId === channelId);
        if (!picked) {
            message.error(t("account.selectMethod"));
            return;
        }
        setSubmitting(true);
        try {
            const body = usingCustom
                ? { amount: customAmount.trim(), method: picked.method, channelId: picked.channelId }
                : { packageId, method: picked.method, channelId: picked.channelId };
            setCheckout(await createRecharge(body, newIdempotencyKey()));
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("account.payFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="py-1">
            {catalog.notice || notice ? <p className="mb-3 text-xs text-stone-500">{catalog.notice || notice}</p> : null}
            {catalog.packages.length ? (
                <div className="mb-4 grid grid-cols-2 gap-2">
                    {catalog.packages.map((item) => (
                        <PackageButton
                            key={item.id}
                            item={item}
                            active={packageId === item.id}
                            onClick={() => {
                                setPackageId(item.id);
                                setCustomAmount("");
                            }}
                        />
                    ))}
                </div>
            ) : null}

            {catalog.allowCustomAmount ? (
                <div className="mb-4">
                    <div className={`mb-2 text-xs ${usingCustom ? "font-medium text-stone-900 dark:text-stone-100" : "text-stone-500"}`}>{t("account.customAmount")}</div>
                    <Input
                        value={customAmount}
                        onChange={(event) => {
                            setCustomAmount(event.target.value);
                            if (event.target.value.trim()) setPackageId(undefined);
                        }}
                        placeholder={t("account.minAmountHint", { amount: formatMoney(catalog.minAmount) })}
                        prefix="¥"
                        allowClear
                    />
                </div>
            ) : null}

            <div className="mb-4 flex gap-2">
                {catalog.channels.map((item) => (
                    <Button key={item.channelId} type={channelId === item.channelId ? "primary" : "default"} onClick={() => setChannelId(item.channelId)}>
                        {item.label}
                    </Button>
                ))}
            </div>

            {selected && formatMoney(selected.salePrice) !== formatMoney(selected.faceValue) ? (
                <p className="mb-3 text-xs text-stone-500">{t("account.discountHint", { paid: formatMoney(selected.salePrice), credit: formatMoney(selected.faceValue) })}</p>
            ) : null}

            <Button type="primary" block loading={submitting} onClick={() => void pay()} disabled={usingCustom ? !customAmount.trim() : !packageId}>
                {t("account.payNow")}
            </Button>
        </div>
    );
}

function PackageButton({ item, active, onClick }: { item: RechargePackageOption; active: boolean; onClick: () => void }) {
    const { t } = useTranslation();
    const discounted = formatMoney(item.salePrice) !== formatMoney(item.faceValue);
    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-md border px-3 py-2 text-left transition-colors ${active ? "border-stone-900 dark:border-stone-100" : "border-stone-200 hover:border-stone-400 dark:border-stone-700"}`}
        >
            <div className="text-sm font-medium">¥{formatMoney(item.salePrice)}</div>
            <div className="text-xs text-stone-500">{discounted ? t("account.creditAmount", { amount: formatMoney(item.faceValue) }) : item.name}</div>
        </button>
    );
}

function RedeemForm({ onSuccess }: { onSuccess: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [form] = Form.useForm<{ code: string }>();
    const [submitting, setSubmitting] = useState(false);
    const refreshWallet = useAuthStore((state) => state.refreshWallet);

    const submit = async (values: { code: string }) => {
        setSubmitting(true);
        try {
            const result = await redeemCard(values.code, newIdempotencyKey());
            message.success(t("account.redeemSuccess", { amount: formatMoney(result.amount) }));
            form.resetFields();
            await refreshWallet();
            onSuccess();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("account.redeemFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void submit(values)}>
            <Form.Item name="code" label={t("account.redeemCode")} rules={[{ required: true, message: t("account.redeemCodeRequired") }]}>
                <Input size="large" prefix={<Ticket className="size-4 opacity-50" />} placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting} block>
                {t("account.redeemAction")}
            </Button>
        </Form>
    );
}
