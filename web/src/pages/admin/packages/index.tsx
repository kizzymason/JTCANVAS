import { App, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Space, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { adminApi, type AdminRechargePackage, type AdminRechargeSettings } from "@/services/api/admin";
import { formatMoney } from "@/services/api/models";

const MONEY_PATTERN = /^\d{1,12}(\.\d{1,6})?$/;

export default function AdminPackagesPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [items, setItems] = useState<AdminRechargePackage[]>([]);
    const [settings, setSettings] = useState<AdminRechargeSettings>({ allowCustomAmount: true, minAmount: "10.000000", maxAmount: "10000.000000" });
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState<AdminRechargePackage | "new" | null>(null);
    const [settingsForm] = Form.useForm<AdminRechargeSettings>();
    const [savingSettings, setSavingSettings] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await adminApi.rechargePackages();
            setItems(result.items);
            setSettings(result.settings);
            settingsForm.setFieldsValue(result.settings);
        } finally {
            setLoading(false);
        }
    }, [settingsForm]);

    useEffect(() => {
        void load();
    }, [load]);

    const saveSettings = async (values: AdminRechargeSettings) => {
        setSavingSettings(true);
        try {
            const result = await adminApi.saveRechargeSettings(values);
            setSettings(result.settings);
            message.success(t("admin.packages.settingsSaved"));
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        } finally {
            setSavingSettings(false);
        }
    };

    const remove = async (id: string) => {
        try {
            await adminApi.deleteRechargePackage(id);
            message.success(t("admin.packages.deleted"));
            await load();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        }
    };

    const columns: ColumnsType<AdminRechargePackage> = [
        { title: t("admin.packages.name"), dataIndex: "name", ellipsis: true },
        { title: t("admin.packages.faceValue"), dataIndex: "faceValue", width: 120, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
        { title: t("admin.packages.salePrice"), dataIndex: "salePrice", width: 120, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
        {
            title: t("admin.packages.enabled"),
            dataIndex: "enabled",
            width: 80,
            render: (value: boolean) => <Tag color={value ? "green" : "default"}>{value ? t("admin.packages.on") : t("admin.packages.off")}</Tag>,
        },
        { title: t("admin.packages.sortOrder"), dataIndex: "sortOrder", width: 90, align: "right" },
        {
            title: t("admin.packages.actions"),
            width: 140,
            render: (_value, row) => (
                <Space size={4}>
                    <Button size="small" type="text" onClick={() => setEditing(row)}>
                        {t("common.edit")}
                    </Button>
                    <Popconfirm title={t("admin.packages.deleteConfirm")} onConfirm={() => void remove(row.id)}>
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
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.packages.title")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{t("admin.packages.description")}</p>
                </div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
                    {t("admin.packages.create")}
                </Button>
            </div>

            <Card size="small" className="max-w-2xl">
                <Form form={settingsForm} layout="vertical" requiredMark={false} initialValues={settings} onFinish={(values) => void saveSettings(values)}>
                    <Form.Item name="allowCustomAmount" label={t("admin.packages.allowCustom")} extra={t("admin.packages.allowCustomHint")} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item name="minAmount" label={t("admin.packages.minAmount")} extra={t("admin.packages.minAmountHint")} rules={[{ required: true }, { pattern: MONEY_PATTERN, message: t("admin.channels.priceInvalid") }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="maxAmount" label={t("admin.packages.maxAmount")} extra={t("admin.packages.maxAmountHint")} rules={[{ required: true }, { pattern: MONEY_PATTERN, message: t("admin.channels.priceInvalid") }]}>
                        <Input />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={savingSettings}>
                        {t("common.save")}
                    </Button>
                </Form>
            </Card>

            <Table rowKey="id" size="small" loading={loading} dataSource={items} columns={columns} pagination={false} />
            <PackageModal
                open={editing !== null}
                pkg={editing === "new" ? null : editing}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null);
                    void load();
                }}
            />
        </div>
    );
}

function PackageModal({
    open,
    pkg,
    onClose,
    onSaved,
}: {
    open: boolean;
    pkg: AdminRechargePackage | null;
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
            pkg
                ? { name: pkg.name, faceValue: pkg.faceValue, salePrice: pkg.salePrice, enabled: pkg.enabled, sortOrder: pkg.sortOrder }
                : { name: "", faceValue: "10.00", salePrice: "10.00", enabled: true, sortOrder: 10 },
        );
    }, [open, pkg, form]);

    const submit = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            if (pkg) await adminApi.updateRechargePackage(pkg.id, values);
            else await adminApi.createRechargePackage(values);
            message.success(t("admin.packages.saved"));
            onSaved();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open={open} title={pkg ? t("admin.packages.edit") : t("admin.packages.create")} onCancel={onClose} onOk={() => void submit()} confirmLoading={saving} destroyOnHidden>
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item name="name" label={t("admin.packages.name")} rules={[{ required: true }]}>
                    <Input maxLength={64} />
                </Form.Item>
                <Form.Item name="faceValue" label={t("admin.packages.faceValue")} extra={t("admin.packages.faceHint")} rules={[{ required: true }, { pattern: MONEY_PATTERN, message: t("admin.channels.priceInvalid") }]}>
                    <Input />
                </Form.Item>
                <Form.Item name="salePrice" label={t("admin.packages.salePrice")} extra={t("admin.packages.saleHint")} rules={[{ required: true }, { pattern: MONEY_PATTERN, message: t("admin.channels.priceInvalid") }]}>
                    <Input />
                </Form.Item>
                <Form.Item name="sortOrder" label={t("admin.packages.sortOrder")}>
                    <InputNumber min={0} max={10000} className="w-full" />
                </Form.Item>
                <Form.Item name="enabled" label={t("admin.packages.enabled")} valuePropName="checked">
                    <Switch />
                </Form.Item>
            </Form>
        </Modal>
    );
}
