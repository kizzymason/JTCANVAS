import { App, Alert, Button, DatePicker, Drawer, Form, Input, InputNumber, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { BookOpen, KeyRound, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ApiError } from "@/services/api/client";
import { formatMoney } from "@/services/api/models";
import { apiBaseUrl, resellerApi, type ApiToken, type CreateApiTokenInput, type ResellerModel } from "@/services/api/reseller";
import { useAdminTable } from "@/pages/admin/use-admin-table";

type TokenForm = {
    name: string;
    quotaLimit?: string;
    rpmLimit?: number;
    concurrencyLimit?: number;
    modelScope?: string[];
    allowedIps?: string;
    expiresAt?: dayjs.Dayjs | null;
};

/** Comma or newline separated, because both are what people paste out of a spreadsheet. */
function parseList(value?: string) {
    if (!value) return [];
    return value
        .split(/[\n,;]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

export default function OpenConsoleTokensPage() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [editing, setEditing] = useState<ApiToken | null>(null);
    const [creating, setCreating] = useState(false);
    const [models, setModels] = useState<ResellerModel[]>([]);
    const baseUrl = apiBaseUrl();

    const table = useAdminTable<ApiToken>(useCallback((params) => resellerApi.tokens(params), []));

    useEffect(() => {
        void resellerApi
            .models()
            .then((result) => setModels(result.models))
            .catch(() => undefined);
    }, []);

    const modelOptions = models.map((model) => ({ value: model.id, label: `${model.displayName} (${model.id})` }));

    const toggleStatus = async (token: ApiToken) => {
        try {
            await resellerApi.updateToken(token.id, { status: token.status === "active" ? "disabled" : "active" });
            message.success(t("openPlatform.tokens.saved"));
            await table.reload();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("openPlatform.tokens.saveFailed"));
        }
    };

    const resetQuota = async (token: ApiToken) => {
        try {
            await resellerApi.resetTokenQuota(token.id);
            message.success(t("openPlatform.tokens.quotaReset"));
            await table.reload();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("openPlatform.tokens.saveFailed"));
        }
    };

    const remove = async (token: ApiToken) => {
        try {
            await resellerApi.removeToken(token.id);
            message.success(t("openPlatform.tokens.removed"));
            await table.reload();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("openPlatform.tokens.saveFailed"));
        }
    };

    const columns: ColumnsType<ApiToken> = [
        { title: t("openPlatform.tokens.name"), dataIndex: "name", ellipsis: true },
        {
            title: t("openPlatform.tokens.secret"),
            width: 190,
            render: (_value, token) => <span className="font-mono text-xs text-stone-500">{`${token.keyPrefix}${"*".repeat(6)}${token.keyTail}`}</span>,
        },
        {
            title: t("openPlatform.tokens.status"),
            dataIndex: "status",
            width: 100,
            render: (value: string, token) => {
                const expired = token.expiresAt && dayjs(token.expiresAt).isBefore(dayjs());
                if (expired) return <Tag color="orange">{t("openPlatform.tokens.expired")}</Tag>;
                return <Tag color={value === "active" ? "green" : "default"}>{t(`openPlatform.tokens.statuses.${value}`)}</Tag>;
            },
        },
        {
            title: t("openPlatform.tokens.quota"),
            width: 170,
            align: "right",
            render: (_value, token) => (
                <span className="tabular-nums">
                    {`¥${formatMoney(token.quotaUsed)}`}
                    <span className="text-stone-500">{token.quotaLimit ? ` / ¥${formatMoney(token.quotaLimit)}` : ` / ${t("openPlatform.tokens.unlimited")}`}</span>
                </span>
            ),
        },
        {
            title: t("openPlatform.tokens.limits"),
            width: 130,
            render: (_value, token) => (
                <span className="text-xs tabular-nums text-stone-500">
                    {t("openPlatform.tokens.limitsValue", {
                        rpm: token.rpmLimit || t("openPlatform.tokens.default"),
                        concurrency: token.concurrencyLimit || t("openPlatform.tokens.default"),
                    })}
                </span>
            ),
        },
        {
            title: t("openPlatform.tokens.scope"),
            width: 120,
            render: (_value, token) =>
                token.modelScope.length ? (
                    <Tooltip title={token.modelScope.join(", ")}>
                        <Tag>{t("openPlatform.tokens.scopeCount", { count: token.modelScope.length })}</Tag>
                    </Tooltip>
                ) : (
                    <span className="text-xs text-stone-500">{t("openPlatform.tokens.allModels")}</span>
                ),
        },
        {
            title: t("openPlatform.tokens.expiresAt"),
            dataIndex: "expiresAt",
            width: 160,
            render: (value: string | null) => (value ? new Date(value).toLocaleString() : t("openPlatform.tokens.noExpiry")),
        },
        {
            title: t("openPlatform.tokens.lastUsedAt"),
            dataIndex: "lastUsedAt",
            width: 160,
            render: (value: string | null) => (value ? new Date(value).toLocaleString() : "-"),
        },
        {
            title: t("openPlatform.tokens.actions"),
            width: 230,
            render: (_value, token) => (
                <Space size={0} wrap>
                    <Button size="small" type="text" onClick={() => setEditing(token)}>
                        {t("openPlatform.tokens.edit")}
                    </Button>
                    <Button size="small" type="text" onClick={() => void toggleStatus(token)}>
                        {t(token.status === "active" ? "openPlatform.tokens.disable" : "openPlatform.tokens.enable")}
                    </Button>
                    <Popconfirm title={t("openPlatform.tokens.resetQuotaConfirm")} onConfirm={() => void resetQuota(token)}>
                        <Button size="small" type="text" icon={<RotateCcw className="size-3.5" />} />
                    </Popconfirm>
                    <Popconfirm title={t("openPlatform.tokens.removeConfirm")} onConfirm={() => void remove(token)}>
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
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("openPlatform.tokens.title")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{t("openPlatform.tokens.description")}</p>
                </div>
                <Space wrap>
                    <Link to="/open/console/docs">
                        <Button icon={<BookOpen className="size-4" />}>{t("openPlatform.tokens.viewDocs")}</Button>
                    </Link>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                        {t("openPlatform.tokens.create")}
                    </Button>
                </Space>
            </div>

            <Alert
                type="info"
                showIcon
                icon={<KeyRound className="size-4" />}
                message={t("openPlatform.tokens.baseUrlTitle")}
                description={
                    // Inherit the card's own color: the info card is inverted against the theme.
                    <div className="flex flex-col gap-1 text-sm">
                        <Typography.Paragraph copyable={{ text: baseUrl }} className="!mb-0 font-mono text-xs !text-inherit">
                            {baseUrl}
                        </Typography.Paragraph>
                        <span className="opacity-75">{t("openPlatform.tokens.baseUrlHint")}</span>
                    </div>
                }
            />

            <Table rowKey="id" size="small" scroll={{ x: 1280 }} loading={table.loading} dataSource={table.items} columns={columns} pagination={table.pagination} />

            <TokenDrawer open={creating} token={null} modelOptions={modelOptions} onClose={() => setCreating(false)} onSaved={() => void table.reload()} />
            <TokenDrawer open={Boolean(editing)} token={editing} modelOptions={modelOptions} onClose={() => setEditing(null)} onSaved={() => void table.reload()} />
        </div>
    );
}

function TokenDrawer({ open, token, modelOptions, onClose, onSaved }: { open: boolean; token: ApiToken | null; modelOptions: Array<{ value: string; label: string }>; onClose: () => void; onSaved: () => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [form] = Form.useForm<TokenForm>();
    const [saving, setSaving] = useState(false);
    const [plaintext, setPlaintext] = useState("");

    useEffect(() => {
        if (!open) return;
        setPlaintext("");
        form.setFieldsValue({
            name: token?.name ?? "",
            quotaLimit: token?.quotaLimit ?? undefined,
            rpmLimit: token?.rpmLimit ?? 0,
            concurrencyLimit: token?.concurrencyLimit ?? 0,
            modelScope: token?.modelScope ?? [],
            allowedIps: (token?.allowedIps ?? []).join("\n"),
            expiresAt: token?.expiresAt ? dayjs(token.expiresAt) : null,
        });
    }, [form, open, token]);

    const submit = async () => {
        const values = await form.validateFields();
        const payload: CreateApiTokenInput = {
            name: values.name?.trim() || undefined,
            quotaLimit: values.quotaLimit?.trim() || undefined,
            rpmLimit: values.rpmLimit ?? 0,
            concurrencyLimit: values.concurrencyLimit ?? 0,
            modelScope: values.modelScope ?? [],
            allowedIps: parseList(values.allowedIps),
            expiresAt: values.expiresAt ? values.expiresAt.toISOString() : undefined,
        };
        setSaving(true);
        try {
            if (token) {
                // Emptied fields have to be cleared explicitly, since `undefined` means "unchanged".
                await resellerApi.updateToken(token.id, {
                    ...payload,
                    clearQuotaLimit: !payload.quotaLimit,
                    clearExpiresAt: !payload.expiresAt,
                });
                message.success(t("openPlatform.tokens.saved"));
                onSaved();
                onClose();
            } else {
                const result = await resellerApi.createToken(payload);
                setPlaintext(result.plaintext);
                onSaved();
            }
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("openPlatform.tokens.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const close = () => {
        setPlaintext("");
        form.resetFields();
        onClose();
    };

    return (
        // A drawer rather than a dialog: the form is tall enough that a centered modal had to be
        // scrolled inside itself on laptop screens, which hid the expiry and IP fields.
        <Drawer
            open={open}
            width={520}
            placement="right"
            title={t(token ? "openPlatform.tokens.editTitle" : "openPlatform.tokens.create")}
            onClose={close}
            destroyOnHidden
            styles={{ body: { paddingBottom: 24 } }}
            footer={
                <div className="flex justify-end gap-2">
                    {plaintext ? null : <Button onClick={close}>{t("common.cancel")}</Button>}
                    <Button type="primary" loading={saving} onClick={plaintext ? close : () => void submit()}>
                        {t(plaintext ? "common.done" : "common.save")}
                    </Button>
                </div>
            }
        >
            {plaintext ? (
                <>
                    <Alert type="warning" showIcon className="mb-3" message={t("openPlatform.tokens.secretOnceTitle")} description={t("openPlatform.tokens.secretOnceHint")} />
                    <Typography.Paragraph copyable={{ text: plaintext }} className="!mb-0 break-all rounded border border-stone-200 bg-stone-50 p-3 font-mono text-xs dark:border-stone-700 dark:bg-stone-900">
                        {plaintext}
                    </Typography.Paragraph>
                </>
            ) : (
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="name" label={t("openPlatform.tokens.name")} rules={[{ max: 64 }]}>
                        <Input placeholder={t("openPlatform.tokens.namePlaceholder")} />
                    </Form.Item>
                    <Form.Item name="quotaLimit" label={t("openPlatform.tokens.quotaLimit")} extra={t("openPlatform.tokens.quotaLimitHint")} rules={[{ pattern: /^\d{1,12}(\.\d{1,6})?$/, message: t("openPlatform.tokens.amountInvalid") }]}>
                        <Input placeholder={t("openPlatform.tokens.unlimited")} allowClear />
                    </Form.Item>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Form.Item name="rpmLimit" label={t("openPlatform.tokens.rpmLimit")} extra={t("openPlatform.tokens.zeroMeansDefault")}>
                            <InputNumber min={0} max={100000} className="w-full" />
                        </Form.Item>
                        <Form.Item name="concurrencyLimit" label={t("openPlatform.tokens.concurrencyLimit")} extra={t("openPlatform.tokens.zeroMeansDefault")}>
                            <InputNumber min={0} max={1000} className="w-full" />
                        </Form.Item>
                    </div>
                    <Form.Item name="modelScope" label={t("openPlatform.tokens.scope")} extra={t("openPlatform.tokens.scopeHint")}>
                        <Select mode="multiple" allowClear showSearch optionFilterProp="label" placeholder={t("openPlatform.tokens.allModels")} options={modelOptions} />
                    </Form.Item>
                    <Form.Item name="allowedIps" label={t("openPlatform.tokens.allowedIps")} extra={t("openPlatform.tokens.allowedIpsHint")}>
                        <Input.TextArea
                            rows={3}
                            placeholder="203.0.113.10&#10;198.51.100.0"
                        />
                    </Form.Item>
                    <Form.Item name="expiresAt" label={t("openPlatform.tokens.expiresAt")} extra={t("openPlatform.tokens.expiresAtHint")}>
                        <DatePicker showTime className="w-full" />
                    </Form.Item>
                </Form>
            )}
        </Drawer>
    );
}
