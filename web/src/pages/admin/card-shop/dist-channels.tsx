import { Alert, App, Button, Form, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Copy, KeyRound, Plus, RefreshCw, Trash2, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import type { AdminCardProduct } from "@/services/api/card-admin";
import {
    cardDistApi,
    type AdminCardMerchant,
    type AdminChannelOrder,
    type CardChannelRanking,
    type CardMerchantLedgerRow,
    type CardMerchantPayout,
    type CardMerchantSummary,
    type UpsertCardMerchantInput,
} from "@/services/api/card-dist";
import { ApiError } from "@/services/api/client";
import { formatMoney } from "@/services/api/models";
import { useAdminTable } from "../use-admin-table";

/** Sales channels, what they sold, what we owe them, and what we have paid. */
export function CardDistChannels({ products }: { products: AdminCardProduct[] }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [merchants, setMerchants] = useState<AdminCardMerchant[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<AdminCardMerchant | null>(null);
    const [creating, setCreating] = useState(false);
    const [paying, setPaying] = useState<AdminCardMerchant | null>(null);
    const [ledgerOf, setLedgerOf] = useState<AdminCardMerchant | null>(null);
    const [issued, setIssued] = useState<{ name: string; secret: string } | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setMerchants((await cardDistApi.merchants()).items);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load().catch(() => undefined);
    }, [load]);

    const reissue = async (merchant: AdminCardMerchant) => {
        try {
            const result = await cardDistApi.reissueSecret(merchant.id);
            setIssued({ name: merchant.name, secret: result.secret });
            await load();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        }
    };

    const remove = async (merchant: AdminCardMerchant) => {
        try {
            await cardDistApi.removeMerchant(merchant.id);
            message.success(t("admin.cardDist.removed"));
            await load();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        }
    };

    const columns: ColumnsType<AdminCardMerchant> = [
        {
            title: t("admin.cardDist.name"),
            dataIndex: "name",
            render: (value: string, row) => (
                <div className="min-w-0">
                    <div className="truncate font-medium">{value}</div>
                    <div className="truncate font-mono text-xs text-stone-500">{`${row.secretPrefix}${"*".repeat(6)}${row.secretTail}`}</div>
                </div>
            ),
        },
        {
            title: t("admin.cardDist.terms"),
            width: 150,
            render: (_value, row) =>
                row.commissionMode === "rate" ? (
                    <span className="text-xs">{t("admin.cardDist.rateOf", { pct: (Number(row.commissionRate) * 100).toFixed(2).replace(/\.?0+$/, "") })}</span>
                ) : (
                    <span className="text-xs">{t("admin.cardDist.fixedOf", { amount: formatMoney(row.commissionRate) })}</span>
                ),
        },
        { title: t("admin.cardDist.grossSales"), dataIndex: "grossSales", width: 120, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
        { title: t("admin.cardDist.cardsSold"), dataIndex: "cardsSold", width: 90, align: "right" },
        { title: t("admin.cardDist.commissionTotal"), dataIndex: "commissionTotal", width: 120, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
        {
            title: t("admin.cardDist.commissionOwed"),
            dataIndex: "commissionBalance",
            width: 120,
            align: "right",
            render: (value: string) => <span className={Number(value) > 0 ? "font-medium tabular-nums text-amber-600 dark:text-amber-400" : "tabular-nums"}>{`¥${formatMoney(value)}`}</span>,
        },
        {
            title: t("admin.cardDist.status"),
            width: 110,
            render: (_value, row) =>
                row.enabled ? (
                    <Tag color="green">{t("admin.cardDist.on")}</Tag>
                ) : (
                    <Typography.Text type="secondary" className="text-xs" title={row.suspendedReason}>
                        <Tag color="red">{t("admin.cardDist.off")}</Tag>
                    </Typography.Text>
                ),
        },
        {
            title: t("admin.cardShop.actions"),
            width: 320,
            render: (_value, row) => (
                <Space size={0} wrap>
                    <Button size="small" type="text" onClick={() => setEditing(row)}>
                        {t("common.edit")}
                    </Button>
                    <Button size="small" type="text" icon={<Wallet className="size-3.5" />} onClick={() => setPaying(row)}>
                        {t("admin.cardDist.payout")}
                    </Button>
                    <Button size="small" type="text" onClick={() => setLedgerOf(row)}>
                        {t("admin.cardDist.ledger")}
                    </Button>
                    <Popconfirm title={t("admin.cardDist.reissueConfirm")} onConfirm={() => void reissue(row)}>
                        <Button size="small" type="text" icon={<RefreshCw className="size-3.5" />} />
                    </Popconfirm>
                    <Popconfirm title={t("admin.cardDist.removeConfirm")} onConfirm={() => void remove(row)}>
                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    const suspended = merchants.filter((item) => !item.enabled && item.suspendedReason);

    return (
        <div className="flex flex-col gap-3">
            <Alert type="info" showIcon message={t("admin.cardDist.modelTitle")} description={t("admin.cardDist.modelBody")} />

            {suspended.length ? (
                <Alert
                    type="warning"
                    showIcon
                    message={t("admin.cardDist.suspendedTitle", { count: suspended.length })}
                    description={
                        <ul className="m-0 list-disc pl-4 text-xs">
                            {suspended.map((item) => (
                                <li key={item.id}>{`${item.name}：${item.suspendedReason}`}</li>
                            ))}
                        </ul>
                    }
                />
            ) : null}

            <div className="flex justify-end">
                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                    {t("admin.cardDist.create")}
                </Button>
            </div>

            <Table rowKey="id" size="small" scroll={{ x: 1200 }} loading={loading} dataSource={merchants} columns={columns} pagination={false} />

            <Tabs
                items={[
                    { key: "ranking", label: t("admin.cardDist.ranking"), children: <RankingTable /> },
                    { key: "orders", label: t("admin.cardDist.orderHistory"), children: <OrdersTable merchants={merchants} onReversed={load} /> },
                    { key: "payouts", label: t("admin.cardDist.payoutHistory"), children: <PayoutsTable merchants={merchants} /> },
                ]}
            />

            <MerchantModal open={creating} merchant={null} products={products} onClose={() => setCreating(false)} onSaved={load} onIssued={setIssued} />
            <MerchantModal open={Boolean(editing)} merchant={editing} products={products} onClose={() => setEditing(null)} onSaved={load} onIssued={setIssued} />
            <PayoutModal merchant={paying} onClose={() => setPaying(null)} onSaved={load} />
            <LedgerModal merchant={ledgerOf} onClose={() => setLedgerOf(null)} />
            <SecretModal issued={issued} onClose={() => setIssued(null)} />
        </div>
    );
}

/** The plaintext secret exists only in this dialog; it is never retrievable afterwards. */
function SecretModal({ issued, onClose }: { issued: { name: string; secret: string } | null; onClose: () => void }) {
    const { t } = useTranslation();
    const copy = useCopyText();
    return (
        <Modal
            open={Boolean(issued)}
            title={t("admin.cardDist.secretTitle", { name: issued?.name })}
            onCancel={onClose}
            onOk={onClose}
            okText={t("common.done")}
            cancelButtonProps={{ style: { display: "none" } }}
            destroyOnHidden
        >
            <Alert type="warning" showIcon className="mb-3" message={t("admin.cardDist.secretOnceTitle")} description={t("admin.cardDist.secretOnceHint")} />
            <div className="flex items-center gap-2 rounded border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-900">
                <span className="min-w-0 flex-1 select-all break-all font-mono text-xs">{issued?.secret}</span>
                <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => issued && copy(issued.secret)} />
            </div>
        </Modal>
    );
}

type MerchantFormValues = UpsertCardMerchantInput & {
    allowedIpsText?: string;
    returnUrlsText?: string;
    ratePercent?: number;
    prices?: Array<{ productId: string; unitPrice: string }>;
};

function MerchantModal({
    open,
    merchant,
    products,
    onClose,
    onSaved,
    onIssued,
}: {
    open: boolean;
    merchant: AdminCardMerchant | null;
    products: AdminCardProduct[];
    onClose: () => void;
    onSaved: () => Promise<void>;
    onIssued: (issued: { name: string; secret: string }) => void;
}) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [form] = Form.useForm<MerchantFormValues>();
    const [saving, setSaving] = useState(false);
    const commissionMode = Form.useWatch("commissionMode", form) ?? merchant?.commissionMode ?? "rate";

    useEffect(() => {
        if (!open) return;
        form.setFieldsValue({
            name: merchant?.name ?? "",
            commissionMode: merchant?.commissionMode ?? "rate",
            // Percent is what an operator negotiates in; the API takes a factor.
            ratePercent: merchant && merchant.commissionMode === "rate" ? Number(merchant.commissionRate) * 100 : 15,
            commissionRate: merchant && merchant.commissionMode === "fixed" ? formatMoney(merchant.commissionRate) : "1.00",
            holdDays: merchant?.holdDays ?? 7,
            dailySalesLimit: merchant ? formatMoney(merchant.dailySalesLimit) : "2000",
            productScope: merchant?.productScope ?? [],
            allowedIpsText: (merchant?.allowedIps ?? []).join("\n"),
            returnUrlsText: (merchant?.returnUrls ?? []).join("\n"),
            checkoutLabel: merchant?.checkoutLabel ?? "",
            payoutAccount: merchant?.payoutAccount ?? "",
            webhookUrl: merchant?.webhookUrl ?? "",
            webhookSecret: "",
            enabled: merchant?.enabled ?? true,
            prices: merchant?.prices?.map((price) => ({ productId: price.productId, unitPrice: formatMoney(price.unitPrice) })) ?? [],
        });
    }, [form, merchant, open]);

    const submit = async () => {
        const values = await form.validateFields();
        const payload: UpsertCardMerchantInput = {
            name: values.name,
            commissionMode: values.commissionMode,
            commissionRate: values.commissionMode === "fixed" ? values.commissionRate : String((values.ratePercent ?? 0) / 100),
            holdDays: values.holdDays,
            dailySalesLimit: values.dailySalesLimit,
            productScope: values.productScope ?? [],
            allowedIps: splitLines(values.allowedIpsText),
            returnUrls: splitLines(values.returnUrlsText),
            checkoutLabel: values.checkoutLabel,
            payoutAccount: values.payoutAccount,
            webhookUrl: values.webhookUrl,
            webhookSecret: values.webhookSecret || undefined,
            enabled: values.enabled,
        };
        setSaving(true);
        try {
            let id = merchant?.id;
            if (merchant) {
                await cardDistApi.updateMerchant(merchant.id, payload);
            } else {
                const created = await cardDistApi.createMerchant(payload);
                id = created.merchant.id;
                onIssued({ name: created.merchant.name, secret: created.secret });
            }
            if (id) await cardDistApi.replacePrices(id, (values.prices ?? []).filter((price) => price.productId && price.unitPrice));
            message.success(t("admin.saved"));
            await onSaved();
            onClose();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open={open}
            width={680}
            title={t(merchant ? "admin.cardDist.editTitle" : "admin.cardDist.create")}
            onCancel={onClose}
            onOk={() => void submit()}
            confirmLoading={saving}
            okText={t("common.save")}
            destroyOnHidden
        >
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item name="name" label={t("admin.cardDist.name")} rules={[{ required: true, max: 128 }]}>
                    <Input placeholder={t("admin.cardDist.namePlaceholder")} />
                </Form.Item>

                <Form.Item name="commissionMode" label={t("admin.cardDist.commissionMode")} extra={t("admin.cardDist.commissionModeHint")}>
                    <Segmented
                        options={[
                            { value: "rate", label: t("admin.cardDist.modeRate") },
                            { value: "fixed", label: t("admin.cardDist.modeFixed") },
                        ]}
                    />
                </Form.Item>

                <div className="grid gap-3 sm:grid-cols-2">
                    {commissionMode === "rate" ? (
                        <Form.Item name="ratePercent" label={t("admin.cardDist.ratePercent")} extra={t("admin.cardDist.ratePercentHint")} rules={[{ required: true }]}>
                            <InputNumber min={0} max={100} step={0.5} addonAfter="%" className="w-full" />
                        </Form.Item>
                    ) : (
                        <Form.Item
                            name="commissionRate"
                            label={t("admin.cardDist.fixedAmount")}
                            extra={t("admin.cardDist.fixedAmountHint")}
                            rules={[{ required: true }, { pattern: /^\d{1,6}(\.\d{1,2})?$/, message: t("admin.cardShop.amountInvalid") }]}
                        >
                            <Input addonBefore="¥" />
                        </Form.Item>
                    )}
                    <Form.Item name="holdDays" label={t("admin.cardDist.holdDays")} extra={t("admin.cardDist.holdDaysHint")}>
                        <InputNumber min={0} max={180} className="w-full" addonAfter={t("admin.cardDist.days")} />
                    </Form.Item>
                </div>

                <Form.Item
                    name="dailySalesLimit"
                    label={t("admin.cardDist.dailyLimit")}
                    extra={t("admin.cardDist.dailyLimitHint")}
                    rules={[{ pattern: /^\d{1,8}(\.\d{1,2})?$/, message: t("admin.cardShop.amountInvalid") }]}
                >
                    <Input addonBefore="¥" />
                </Form.Item>

                <Form.Item name="returnUrlsText" label={t("admin.cardDist.returnUrls")} extra={t("admin.cardDist.returnUrlsHint")}>
                    <Input.TextArea rows={2} placeholder={"https://shop.example.com/pay/result"} />
                </Form.Item>

                <Form.Item name="checkoutLabel" label={t("admin.cardDist.checkoutLabel")} extra={t("admin.cardDist.checkoutLabelHint")}>
                    <Input placeholder={t("admin.cardDist.checkoutLabelPlaceholder")} />
                </Form.Item>

                <Form.Item name="productScope" label={t("admin.cardDist.scope")} extra={t("admin.cardDist.scopeHint")}>
                    <Select mode="multiple" allowClear placeholder={t("admin.cardDist.allProducts")} options={products.map((item) => ({ value: item.id, label: item.name }))} />
                </Form.Item>

                <Form.List name="prices">
                    {(fields, { add, remove }) => (
                        <div className="mb-3 flex flex-col gap-2 rounded border border-stone-200 p-3 dark:border-stone-800">
                            <span className="text-xs font-medium text-stone-500">{t("admin.cardDist.priceOverrideTitle")}</span>
                            <span className="text-xs text-stone-400">{t("admin.cardDist.priceOverrideHint")}</span>
                            {fields.map((field) => (
                                <div key={field.key} className="flex gap-2">
                                    <Form.Item {...field} name={[field.name, "productId"]} className="!mb-0 flex-1" rules={[{ required: true }]}>
                                        <Select placeholder={t("admin.cardShop.product")} options={products.map((item) => ({ value: item.id, label: item.name }))} />
                                    </Form.Item>
                                    <Form.Item
                                        {...field}
                                        name={[field.name, "unitPrice"]}
                                        className="!mb-0 w-32"
                                        rules={[{ required: true }, { pattern: /^\d{1,6}(\.\d{1,2})?$/, message: t("admin.cardShop.amountInvalid") }]}
                                    >
                                        <Input addonBefore="¥" />
                                    </Form.Item>
                                    <Button type="text" danger icon={<Trash2 className="size-3.5" />} onClick={() => remove(field.name)} />
                                </div>
                            ))}
                            <Button size="small" onClick={() => add({ productId: undefined, unitPrice: "" })}>
                                {t("admin.cardDist.addPrice")}
                            </Button>
                        </div>
                    )}
                </Form.List>

                <Form.Item name="allowedIpsText" label={t("admin.cardDist.allowedIps")} extra={t("admin.cardDist.allowedIpsHint")}>
                    <Input.TextArea rows={2} placeholder="203.0.113.10&#10;198.51.100.7" />
                </Form.Item>

                <Form.Item name="payoutAccount" label={t("admin.cardDist.payoutAccount")} extra={t("admin.cardDist.payoutAccountHint")}>
                    <Input.TextArea rows={2} />
                </Form.Item>

                <Form.Item name="webhookUrl" label={t("admin.cardDist.webhookUrl")} extra={t("admin.cardDist.webhookUrlHint")}>
                    <Input placeholder="https://" />
                </Form.Item>
                <Form.Item name="webhookSecret" label={t("admin.cardDist.webhookSecret")} extra={t("admin.cardDist.webhookSecretHint")}>
                    <Input placeholder={merchant?.hasWebhookSecret ? t("admin.cardDist.webhookSecretSet") : ""} />
                </Form.Item>

                <Form.Item name="enabled" label={t("admin.cardDist.status")} valuePropName="checked" extra={t("admin.cardDist.statusHint")}>
                    <Switch />
                </Form.Item>
            </Form>
        </Modal>
    );
}

function splitLines(value?: string) {
    return (value ?? "")
        .split(/[\s,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
}

/** Records a dividend that has already been transferred, and offsets it against what we owe. */
function PayoutModal({ merchant, onClose, onSaved }: { merchant: AdminCardMerchant | null; onClose: () => void; onSaved: () => Promise<void> }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [form] = Form.useForm<{ amount: string; method: string; reference?: string; note?: string }>();
    const [summary, setSummary] = useState<CardMerchantSummary | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!merchant) return;
        form.setFieldsValue({ amount: "", method: t("admin.cardDist.methodBank"), reference: "", note: "" });
        let cancelled = false;
        void cardDistApi
            .summary(merchant.id)
            .then((result) => !cancelled && setSummary(result))
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [form, merchant, t]);

    const submit = async () => {
        if (!merchant) return;
        const values = await form.validateFields();
        setSaving(true);
        try {
            const result = await cardDistApi.payout(merchant.id, values);
            message.success(t("admin.cardDist.payoutSaved", { balance: formatMoney(result.commissionBalance) }));
            await onSaved();
            onClose();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open={Boolean(merchant)}
            title={t("admin.cardDist.payoutTitle", { name: merchant?.name })}
            onCancel={onClose}
            onOk={() => void submit()}
            confirmLoading={saving}
            okText={t("admin.cardDist.payoutConfirm")}
            destroyOnHidden
        >
            <Alert className="mb-3" type="info" showIcon message={t("admin.cardDist.payoutManualTitle")} description={t("admin.cardDist.payoutManualHint")} />
            {summary ? (
                <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
                    <Stat label={t("admin.cardDist.grossSales")} value={`¥${formatMoney(summary.grossSales)}`} />
                    <Stat label={t("admin.cardDist.commissionTotal")} value={`¥${formatMoney(summary.commissionTotal)}`} />
                    <Stat label={t("admin.cardDist.commissionOwed")} value={`¥${formatMoney(summary.commissionBalance)}`} />
                    <Stat label={t("admin.cardDist.commissionHeld")} value={`¥${formatMoney(summary.commissionHeld)}`} />
                    <Stat label={t("admin.cardDist.commissionPayable")} value={`¥${formatMoney(summary.commissionPayable)}`} strong />
                    <Stat label={t("admin.cardDist.paidOut")} value={`¥${formatMoney(summary.paidOut)}`} />
                </div>
            ) : null}
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item
                    name="amount"
                    label={t("admin.cardDist.payoutAmount")}
                    extra={t("admin.cardDist.payoutAmountHint")}
                    rules={[{ required: true }, { pattern: /^\d{1,8}(\.\d{1,2})?$/, message: t("admin.cardShop.amountInvalid") }]}
                >
                    <Input addonBefore="¥" />
                </Form.Item>
                <Form.Item name="method" label={t("admin.cardDist.payoutMethod")} rules={[{ required: true, max: 64 }]}>
                    <Input />
                </Form.Item>
                <Form.Item name="reference" label={t("admin.cardDist.payoutReference")} extra={t("admin.cardDist.payoutReferenceHint")}>
                    <Input />
                </Form.Item>
                <Form.Item name="note" label={t("admin.cardDist.note")}>
                    <Input.TextArea rows={2} />
                </Form.Item>
            </Form>
        </Modal>
    );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div className="rounded border border-stone-200 px-3 py-2 dark:border-stone-800">
            <div className="text-[10px] uppercase tracking-wider text-stone-500">{label}</div>
            <div className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{value}</div>
        </div>
    );
}

function LedgerModal({ merchant, onClose }: { merchant: AdminCardMerchant | null; onClose: () => void }) {
    const { t } = useTranslation();
    const [rows, setRows] = useState<CardMerchantLedgerRow[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!merchant) return;
        let cancelled = false;
        setLoading(true);
        void cardDistApi
            .ledger(merchant.id, { page: 1, pageSize: 50 })
            .then((result) => !cancelled && setRows(result.items))
            .catch(() => undefined)
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [merchant]);

    return (
        <Modal open={Boolean(merchant)} width={720} title={t("admin.cardDist.ledgerTitle", { name: merchant?.name })} footer={null} onCancel={onClose} destroyOnHidden>
            <Table
                rowKey="id"
                size="small"
                loading={loading}
                dataSource={rows}
                pagination={false}
                scroll={{ y: 420 }}
                columns={[
                    { title: t("admin.cardDist.time"), dataIndex: "createdAt", width: 165, render: (value: string) => new Date(value).toLocaleString() },
                    { title: t("admin.cardDist.type"), dataIndex: "type", width: 100, render: (value: string) => t(`admin.cardDist.types.${value}`) },
                    {
                        title: t("admin.cardDist.amount"),
                        dataIndex: "amount",
                        width: 110,
                        align: "right",
                        render: (value: string) => (
                            <span className={Number(value) < 0 ? "tabular-nums text-red-600 dark:text-red-400" : "tabular-nums text-emerald-600 dark:text-emerald-400"}>{`¥${formatMoney(value)}`}</span>
                        ),
                    },
                    { title: t("admin.cardDist.balanceAfter"), dataIndex: "balanceAfter", width: 110, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
                    { title: t("admin.cardDist.note"), dataIndex: "note", ellipsis: true },
                ]}
            />
        </Modal>
    );
}

function RankingTable() {
    const { t } = useTranslation();
    const [days, setDays] = useState(30);
    const [rows, setRows] = useState<CardChannelRanking[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        void cardDistApi
            .leaderboard(days || undefined)
            .then((result) => !cancelled && setRows(result.items))
            .catch(() => undefined)
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [days]);

    return (
        <div className="flex flex-col gap-3">
            <Segmented
                value={days}
                onChange={(value) => setDays(Number(value))}
                options={[
                    { value: 7, label: t("admin.cardDist.last7") },
                    { value: 30, label: t("admin.cardDist.last30") },
                    { value: 0, label: t("admin.cardDist.allTime") },
                ]}
            />
            <Table
                rowKey="merchantId"
                size="small"
                loading={loading}
                dataSource={rows}
                pagination={false}
                columns={[
                    { title: "#", width: 50, render: (_value, _row, index) => index + 1 },
                    { title: t("admin.cardDist.merchant"), dataIndex: "merchantName", ellipsis: true },
                    { title: t("admin.cardDist.orders"), dataIndex: "orders", width: 90, align: "right" },
                    { title: t("admin.cardDist.cardsSold"), dataIndex: "cards", width: 90, align: "right" },
                    { title: t("admin.cardDist.grossSales"), dataIndex: "grossSales", width: 130, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
                    { title: t("admin.cardDist.commissionTotal"), dataIndex: "commission", width: 130, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
                ]}
            />
        </div>
    );
}

function OrdersTable({ merchants, onReversed }: { merchants: AdminCardMerchant[]; onReversed: () => Promise<void> }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const copy = useCopyText();
    const [merchantId, setMerchantId] = useState<string | undefined>();

    const table = useAdminTable<AdminChannelOrder>(
        useCallback((params) => cardDistApi.orders({ ...params, merchantId }), [merchantId]),
        [merchantId],
    );

    const showCodes = async (order: AdminChannelOrder) => {
        try {
            const result = await cardDistApi.orderCodes(order.id);
            Modal.info({
                title: t("admin.cardDist.codesTitle", { orderNo: order.orderNo }),
                width: 520,
                content: (
                    <div className="mt-3 flex max-h-80 flex-col gap-1 overflow-y-auto">
                        {result.items.map((item) => (
                            <span key={item.code} className="break-all font-mono text-xs">
                                {item.code}
                            </span>
                        ))}
                        <Button className="mt-2 w-fit" size="small" icon={<Copy className="size-3.5" />} onClick={() => copy(result.items.map((item) => item.code).join("\n"))}>
                            {t("admin.cardShop.copyCodes")}
                        </Button>
                    </div>
                ),
            });
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.loadFailed"));
        }
    };

    const reverse = (order: AdminChannelOrder) => {
        let note = "";
        Modal.confirm({
            title: t("admin.cardDist.reverseTitle", { orderNo: order.orderNo }),
            content: (
                <div className="mt-2 flex flex-col gap-2">
                    <span className="text-xs text-stone-500">{t("admin.cardDist.reverseHint")}</span>
                    <Input.TextArea rows={2} placeholder={t("admin.cardDist.reverseReason")} onChange={(event) => (note = event.target.value)} />
                </div>
            ),
            okText: t("admin.cardDist.reverseConfirm"),
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    const result = await cardDistApi.reverse({ orderNo: order.orderNo, note: note.trim() || t("admin.cardDist.reverseReason") });
                    if (Number(result.shortfall) > 0) {
                        message.warning(t("admin.cardDist.reverseShortfall", { amount: formatMoney(result.shortfall) }));
                    } else {
                        message.success(t("admin.cardDist.reverseDone", { amount: formatMoney(result.reversed) }));
                    }
                    await table.reload();
                    await onReversed();
                } catch (error) {
                    message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
                    throw error;
                }
            },
        });
    };

    return (
        <div className="flex flex-col gap-3">
            <Select
                allowClear
                style={{ width: 220 }}
                placeholder={t("admin.cardDist.filterMerchant")}
                value={merchantId}
                onChange={(value) => {
                    table.setPage(1);
                    setMerchantId(value);
                }}
                options={merchants.map((item) => ({ value: item.id, label: item.name }))}
            />
            <Table
                rowKey="id"
                size="small"
                scroll={{ x: 1200 }}
                loading={table.loading}
                dataSource={table.items}
                pagination={table.pagination}
                columns={[
                    { title: t("admin.cardDist.time"), dataIndex: "createdAt", width: 155, render: (value: string) => new Date(value).toLocaleString() },
                    { title: t("admin.cardDist.merchant"), dataIndex: "merchantName", width: 130, ellipsis: true },
                    { title: t("admin.cardDist.orderNo"), dataIndex: "orderNo", width: 190, render: (value: string) => <span className="font-mono text-xs">{value}</span> },
                    { title: t("admin.cardDist.reference"), dataIndex: "merchantReference", width: 130, ellipsis: true },
                    { title: t("admin.cardShop.product"), dataIndex: "productName", ellipsis: true },
                    { title: t("admin.cardShop.quantityShort"), dataIndex: "quantity", width: 70, align: "right" },
                    { title: t("admin.cardShop.amount"), dataIndex: "amount", width: 100, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
                    {
                        title: t("admin.cardShop.status"),
                        dataIndex: "status",
                        width: 90,
                        render: (value: string) => <Tag color={value === "paid" ? "green" : value === "pending" ? "gold" : "default"}>{t(`cardShop.statuses.${value}`)}</Tag>,
                    },
                    {
                        title: t("admin.cardDist.commission"),
                        width: 140,
                        align: "right",
                        render: (_value, row) => (
                            <div className="text-right">
                                <div className="tabular-nums">{`¥${formatMoney(row.commissionAmount)}`}</div>
                                <div className="text-[10px] text-stone-500">{t(`admin.cardDist.states.${row.commissionState}`)}</div>
                            </div>
                        ),
                    },
                    {
                        title: t("admin.cardShop.actions"),
                        width: 170,
                        render: (_value, row) => (
                            <Space size={0}>
                                {row.status === "paid" ? (
                                    <Button size="small" type="text" icon={<KeyRound className="size-3.5" />} onClick={() => void showCodes(row)}>
                                        {t("admin.cardShop.viewCodes")}
                                    </Button>
                                ) : null}
                                {row.status === "paid" && row.commissionState !== "reversed" && Number(row.commissionAmount) > 0 ? (
                                    <Button size="small" type="text" danger onClick={() => reverse(row)}>
                                        {t("admin.cardDist.reverse")}
                                    </Button>
                                ) : null}
                            </Space>
                        ),
                    },
                ]}
            />
        </div>
    );
}

function PayoutsTable({ merchants }: { merchants: AdminCardMerchant[] }) {
    const { t } = useTranslation();
    const [merchantId, setMerchantId] = useState<string | undefined>();
    const table = useAdminTable<CardMerchantPayout>(
        useCallback((params) => cardDistApi.payouts({ ...params, merchantId }), [merchantId]),
        [merchantId],
    );

    return (
        <div className="flex flex-col gap-3">
            <Select
                allowClear
                style={{ width: 220 }}
                placeholder={t("admin.cardDist.filterMerchant")}
                value={merchantId}
                onChange={(value) => {
                    table.setPage(1);
                    setMerchantId(value);
                }}
                options={merchants.map((item) => ({ value: item.id, label: item.name }))}
            />
            <Table
                rowKey="id"
                size="small"
                loading={table.loading}
                dataSource={table.items}
                pagination={table.pagination}
                columns={[
                    { title: t("admin.cardDist.time"), dataIndex: "createdAt", width: 165, render: (value: string) => new Date(value).toLocaleString() },
                    { title: t("admin.cardDist.merchant"), dataIndex: "merchantName", width: 150, ellipsis: true },
                    { title: t("admin.cardDist.amount"), dataIndex: "amount", width: 120, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
                    { title: t("admin.cardDist.payoutMethod"), dataIndex: "method", width: 120 },
                    { title: t("admin.cardDist.payoutReference"), dataIndex: "reference", width: 160, ellipsis: true },
                    { title: t("admin.cardDist.note"), dataIndex: "note", ellipsis: true },
                ]}
            />
        </div>
    );
}
