import { Alert, App, Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import Decimal from "decimal.js";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { adminApi, type AdminResellerTier } from "@/services/api/admin";

type TierForm = { name: string; surchargePercent: number; description?: string; isDefault?: boolean; sortOrder?: number };

function surchargeLabel(multiplier: string) {
    try {
        const value = new Decimal(multiplier).times(100);
        if (value.isZero()) return "0%";
        return `${value.isPositive() ? "+" : ""}${value.toDecimalPlaces(2).toString()}%`;
    } catch {
        return "-";
    }
}

/** Shows the effect of a surcharge on a familiar price so a sign mistake is obvious before saving. */
function previewPrice(surchargePercent: number, base = 0.3) {
    try {
        return new Decimal(base)
            .times(new Decimal(1).plus(new Decimal(surchargePercent).dividedBy(100)))
            .toDecimalPlaces(4)
            .toString();
    } catch {
        return base.toFixed(2);
    }
}

export default function AdminResellerTiersPage() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [items, setItems] = useState<AdminResellerTier[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<AdminResellerTier | null>(null);
    const [creating, setCreating] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await adminApi.resellerTiers();
            setItems(result.items);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const remove = async (tier: AdminResellerTier) => {
        try {
            await adminApi.deleteResellerTier(tier.id);
            message.success(t("admin.resellerTiers.removed"));
            await load();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        }
    };

    const columns: ColumnsType<AdminResellerTier> = [
        {
            title: t("admin.resellerTiers.name"),
            dataIndex: "name",
            render: (value: string, tier) => (
                <span className="inline-flex items-center gap-2">
                    {value}
                    {tier.isDefault ? <Tag color="blue">{t("admin.resellerTiers.default")}</Tag> : null}
                </span>
            ),
        },
        {
            title: t("admin.resellerTiers.surcharge"),
            dataIndex: "multiplier",
            width: 130,
            align: "right",
            render: (value: string) => <span className="tabular-nums">{surchargeLabel(value)}</span>,
        },
        {
            title: t("admin.resellerTiers.example"),
            width: 170,
            align: "right",
            render: (_value, tier) => <span className="tabular-nums text-stone-500">{t("admin.resellerTiers.exampleValue", { price: previewPrice(new Decimal(tier.multiplier).times(100).toNumber()) })}</span>,
        },
        { title: t("admin.resellerTiers.resellerCount"), dataIndex: "resellerCount", width: 110, align: "right" },
        { title: t("admin.resellerTiers.sortOrder"), dataIndex: "sortOrder", width: 90, align: "right" },
        { title: t("admin.resellerTiers.descriptionField"), dataIndex: "description", ellipsis: true, render: (value: string) => value || "-" },
        {
            title: t("admin.resellerTiers.actions"),
            width: 150,
            render: (_value, tier) => (
                <Space size={0}>
                    <Button size="small" type="text" onClick={() => setEditing(tier)}>
                        {t("common.edit")}
                    </Button>
                    <Popconfirm title={t("admin.resellerTiers.removeConfirm")} onConfirm={() => void remove(tier)}>
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
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.resellerTiers.title")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{t("admin.resellerTiers.description")}</p>
                </div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                    {t("admin.resellerTiers.create")}
                </Button>
            </div>

            <Alert type="info" showIcon message={t("admin.resellerTiers.formulaTitle")} description={t("admin.resellerTiers.formulaBody")} />

            <Table rowKey="id" size="small" loading={loading} dataSource={items} columns={columns} pagination={false} />

            <TierModal open={creating} tier={null} onClose={() => setCreating(false)} onSaved={load} />
            <TierModal open={Boolean(editing)} tier={editing} onClose={() => setEditing(null)} onSaved={load} />
        </div>
    );
}

function TierModal({ open, tier, onClose, onSaved }: { open: boolean; tier: AdminResellerTier | null; onClose: () => void; onSaved: () => Promise<void> }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [form] = Form.useForm<TierForm>();
    const [saving, setSaving] = useState(false);
    const surchargePercent = Form.useWatch("surchargePercent", form) ?? 0;

    useEffect(() => {
        if (!open) return;
        form.setFieldsValue({
            name: tier?.name ?? "",
            surchargePercent: tier ? new Decimal(tier.multiplier).times(100).toNumber() : 0,
            description: tier?.description ?? "",
            isDefault: tier?.isDefault ?? false,
            sortOrder: tier?.sortOrder ?? 100,
        });
    }, [form, open, tier]);

    const submit = async () => {
        const values = await form.validateFields();
        const payload = {
            name: values.name.trim(),
            multiplier: new Decimal(values.surchargePercent).dividedBy(100).toFixed(6),
            description: values.description?.trim() ?? "",
            isDefault: values.isDefault ?? false,
            sortOrder: values.sortOrder ?? 100,
        };
        setSaving(true);
        try {
            if (tier) await adminApi.updateResellerTier(tier.id, payload);
            else await adminApi.createResellerTier(payload);
            message.success(t("admin.resellerTiers.saved"));
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
            title={t(tier ? "admin.resellerTiers.editTitle" : "admin.resellerTiers.create")}
            onCancel={onClose}
            onOk={() => void submit()}
            confirmLoading={saving}
            okText={t("common.save")}
            destroyOnHidden
        >
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item name="name" label={t("admin.resellerTiers.name")} rules={[{ required: true, max: 64 }]}>
                    <Input />
                </Form.Item>
                <Form.Item
                    name="surchargePercent"
                    label={t("admin.resellerTiers.surcharge")}
                    extra={t("admin.resellerTiers.surchargeHint", { price: previewPrice(Number(surchargePercent) || 0) })}
                    rules={[{ required: true }]}
                >
                    <InputNumber min={-99} max={10000} step={1} addonAfter="%" className="w-full" />
                </Form.Item>
                <Form.Item name="sortOrder" label={t("admin.resellerTiers.sortOrder")}>
                    <InputNumber min={0} max={100000} className="w-full" />
                </Form.Item>
                <Form.Item name="description" label={t("admin.resellerTiers.descriptionField")}>
                    <Input.TextArea rows={3} maxLength={500} />
                </Form.Item>
                <Form.Item name="isDefault" label={t("admin.resellerTiers.default")} extra={t("admin.resellerTiers.defaultHint")} valuePropName="checked">
                    <Switch />
                </Form.Item>
            </Form>
        </Modal>
    );
}
