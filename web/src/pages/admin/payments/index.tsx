import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Plus, Trash2, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { adminApi, type AdminPaymentChannel } from "@/services/api/admin";

const DRIVER_OPTIONS = [{ value: "epay", label: "易支付 / Z-Pay" }];
const METHOD_OPTIONS = [
    { value: "alipay", labelKey: "admin.payments.alipay" },
    { value: "wxpay", labelKey: "admin.payments.wxpay" },
];

export default function AdminPaymentsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [items, setItems] = useState<AdminPaymentChannel[]>([]);
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState<AdminPaymentChannel | "new" | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setItems(await adminApi.paymentChannels());
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const remove = async (id: string) => {
        try {
            await adminApi.deletePaymentChannel(id);
            message.success(t("admin.payments.deleted"));
            await load();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        }
    };

    const queryBalance = async (id: string) => {
        try {
            const result = await adminApi.paymentChannelBalance(id);
            message.success(t("admin.payments.balanceResult", { amount: result.balance }));
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        }
    };

    const columns: ColumnsType<AdminPaymentChannel> = [
        { title: t("admin.payments.name"), dataIndex: "name", ellipsis: true },
        { title: t("admin.payments.driver"), dataIndex: "driver", width: 110, render: (value: string) => (value === "epay" ? "易支付" : value) },
        { title: t("admin.payments.merchantId"), dataIndex: "merchantId", width: 180, ellipsis: true },
        {
            title: t("admin.payments.methods"),
            dataIndex: "methods",
            width: 160,
            render: (methods: string[]) => methods.map((method) => t(`admin.payments.${method}`)).join(" / "),
        },
        {
            title: t("admin.payments.enabled"),
            dataIndex: "enabled",
            width: 80,
            render: (value: boolean) => <Tag color={value ? "green" : "default"}>{value ? t("admin.payments.on") : t("admin.payments.off")}</Tag>,
        },
        {
            title: t("admin.payments.secret"),
            dataIndex: "hasSecret",
            width: 90,
            render: (value: boolean) => (value ? t("admin.payments.secretSet") : t("admin.payments.secretMissing")),
        },
        {
            title: t("admin.payments.actions"),
            width: 220,
            render: (_value, row) => (
                <Space size={4}>
                    <Button size="small" type="text" onClick={() => setEditing(row)}>
                        {t("common.edit")}
                    </Button>
                    <Button size="small" type="text" icon={<Wallet className="size-3.5" />} onClick={() => void queryBalance(row.id)}>
                        {t("admin.payments.balance")}
                    </Button>
                    <Popconfirm title={t("admin.payments.deleteConfirm")} onConfirm={() => void remove(row.id)}>
                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.payments.title")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{t("admin.payments.description")}</p>
                </div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
                    {t("admin.payments.create")}
                </Button>
            </div>

            <Table rowKey="id" size="small" loading={loading} dataSource={items} columns={columns} pagination={false} />
            <ChannelModal
                open={editing !== null}
                channel={editing === "new" ? null : editing}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null);
                    void load();
                }}
            />
        </div>
    );
}

function ChannelModal({
    open,
    channel,
    onClose,
    onSaved,
}: {
    open: boolean;
    channel: AdminPaymentChannel | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [form] = Form.useForm();
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        form.resetFields();
        form.setFieldsValue(
            channel
                ? {
                      name: channel.name,
                      driver: channel.driver,
                      gatewayUrl: channel.gatewayUrl,
                      merchantId: channel.merchantId,
                      methods: channel.methods,
                      cid: channel.cid,
                      enabled: channel.enabled,
                      sortOrder: channel.sortOrder,
                      secret: "",
                  }
                : { name: "Z-Pay", driver: "epay", gatewayUrl: "https://zpayz.cn", merchantId: "", methods: ["alipay"], cid: "", enabled: true, sortOrder: 10, secret: "" },
        );
    }, [open, channel, form]);

    const submit = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            const body = {
                name: values.name,
                driver: values.driver,
                gatewayUrl: values.gatewayUrl,
                merchantId: values.merchantId,
                methods: values.methods,
                cid: values.cid || undefined,
                enabled: values.enabled,
                sortOrder: values.sortOrder,
                ...(values.secret ? { secret: values.secret } : {}),
            };
            if (channel) await adminApi.updatePaymentChannel(channel.id, body);
            else await adminApi.createPaymentChannel({ ...body, secret: values.secret });
            message.success(t("admin.payments.saved"));
            onSaved();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open={open} title={channel ? t("admin.payments.edit") : t("admin.payments.create")} onCancel={onClose} onOk={() => void submit()} confirmLoading={saving} destroyOnHidden>
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item name="name" label={t("admin.payments.name")} rules={[{ required: true }]}>
                    <Input maxLength={64} />
                </Form.Item>
                <Form.Item name="driver" label={t("admin.payments.driver")} rules={[{ required: true }]}>
                    <Select options={DRIVER_OPTIONS} />
                </Form.Item>
                <Form.Item name="gatewayUrl" label={t("admin.payments.gatewayUrl")} extra={t("admin.payments.gatewayHint")} rules={[{ required: true }]}>
                    <Input placeholder="https://zpayz.cn" />
                </Form.Item>
                <Form.Item name="merchantId" label={t("admin.payments.merchantId")} extra={t("admin.payments.merchantHint")} rules={[{ required: true }]}>
                    <Input maxLength={64} />
                </Form.Item>
                <Form.Item name="secret" label={t("admin.payments.secret")} extra={channel ? t("admin.payments.secretHint") : undefined} rules={channel ? [] : [{ required: true, message: t("admin.payments.secretRequired") }]}>
                    <Input.Password autoComplete="new-password" />
                </Form.Item>
                <Form.Item name="methods" label={t("admin.payments.methods")} rules={[{ required: true, type: "array", min: 1 }]}>
                    <Select mode="multiple" options={METHOD_OPTIONS.map((item) => ({ value: item.value, label: t(item.labelKey) }))} />
                </Form.Item>
                <Form.Item name="cid" label={t("admin.payments.cid")} extra={t("admin.payments.cidHint")}>
                    <Input maxLength={128} />
                </Form.Item>
                <Form.Item name="sortOrder" label={t("admin.payments.sortOrder")}>
                    <InputNumber min={0} max={10000} className="w-full" />
                </Form.Item>
                <Form.Item name="enabled" label={t("admin.payments.enabled")} valuePropName="checked">
                    <Switch />
                </Form.Item>
            </Form>
        </Modal>
    );
}
