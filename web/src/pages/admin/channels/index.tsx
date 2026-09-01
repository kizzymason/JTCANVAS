import { App, Button, Card, Checkbox, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ApiError } from "@/services/api/client";
import { adminApi, type AdminChannel, type AdminChannelModel, type AdminModelPrice } from "@/services/api/admin";
import { formatMoney } from "@/services/api/models";
import { PIAPI_BASE_URL, PIAPI_SEEDREAM_LABELS, PIAPI_SEEDREAM_TASK_TYPES } from "@/lib/piapi/piapi-models";
import { defaultAspectPresets, defaultVideoAspectPresets, parseAspectPresets, piapiAspectPresets } from "@/lib/aspect-presets";
import { DEFAULT_MODEL_FEATURES, IMAGE_RESOLUTIONS } from "@/lib/model-features";
import { AspectPresetEditor } from "./components/aspect-preset-editor";

const capabilityOptions = ["image", "video", "text", "audio"] as const;
const billingOptions = ["per_image", "per_second", "per_call"] as const;

/**
 * Channels, their models and each model's price. Everything here used to live in the browser; it is
 * admin-only now because it holds provider credentials and decides what users get charged.
 */
export default function AdminChannelsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [channels, setChannels] = useState<AdminChannel[]>([]);
    const [loading, setLoading] = useState(false);
    const [editingChannel, setEditingChannel] = useState<AdminChannel | "new" | null>(null);
    const [editingModel, setEditingModel] = useState<{ channelId: string; model?: AdminChannelModel } | null>(null);
    const [editingPrice, setEditingPrice] = useState<{ modelId: string; price?: AdminModelPrice } | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setChannels(await adminApi.channels());
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const columns: ColumnsType<AdminChannel> = [
        { title: t("admin.channels.name"), dataIndex: "name", ellipsis: true },
        { title: t("admin.channels.protocol"), dataIndex: "apiFormat", width: 100, render: (value: string) => <Tag>{value}</Tag> },
        { title: t("admin.channels.baseUrl"), dataIndex: "baseUrl", ellipsis: true, render: (value: string) => <span className="font-mono text-xs text-stone-500">{value}</span> },
        {
            title: t("admin.channels.apiKey"),
            dataIndex: "hasApiKey",
            width: 110,
            // The key is never returned by the API, so only its presence can be shown.
            render: (value: boolean, channel) => (channel.apiFormat === "piapi" ? <Tag>{t("admin.channels.usesPool")}</Tag> : <Tag color={value ? "green" : "red"}>{t(value ? "admin.channels.keySet" : "admin.channels.keyMissing")}</Tag>),
        },
        { title: t("admin.channels.priority"), dataIndex: "priority", width: 90, align: "right" },
        { title: t("admin.channels.enabled"), dataIndex: "enabled", width: 90, render: (value: boolean) => <Tag color={value ? "green" : "default"}>{t(value ? "admin.channels.on" : "admin.channels.off")}</Tag> },
        {
            title: t("admin.channels.actions"),
            width: 190,
            render: (_value, channel) => (
                <Space size={4}>
                    <Button size="small" type="text" onClick={() => setEditingChannel(channel)}>
                        {t("common.edit")}
                    </Button>
                    <Button size="small" type="text" onClick={() => setEditingModel({ channelId: channel.id })}>
                        {t("admin.channels.addModel")}
                    </Button>
                    <Popconfirm title={t("admin.channels.deleteConfirm")} onConfirm={() => void remove(channel.id)}>
                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    const remove = async (id: string) => {
        try {
            await adminApi.deleteChannel(id);
            message.success(t("admin.channels.deleted"));
            await load();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.channels.title")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{t("admin.channels.description")}</p>
                </div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setEditingChannel("new")}>
                    {t("admin.channels.create")}
                </Button>
            </div>

            <Table
                rowKey="id"
                size="small"
                loading={loading}
                dataSource={channels}
                columns={columns}
                pagination={false}
                expandable={{
                    expandedRowRender: (channel) => <ModelsTable channel={channel} onAddPrice={(modelId) => setEditingPrice({ modelId })} onEditPrice={(modelId, price) => setEditingPrice({ modelId, price })} onEditModel={(model) => setEditingModel({ channelId: channel.id, model })} onChanged={load} />,
                    rowExpandable: () => true,
                }}
            />

            <ChannelModal target={editingChannel} onClose={() => setEditingChannel(null)} onSaved={load} />
            <ModelModal target={editingModel} onClose={() => setEditingModel(null)} onSaved={load} />
            <PriceModal target={editingPrice} onClose={() => setEditingPrice(null)} onSaved={load} />
        </div>
    );

    function ModelsTable({ channel, onAddPrice, onEditPrice, onEditModel, onChanged }: { channel: AdminChannel; onAddPrice: (modelId: string) => void; onEditPrice: (modelId: string, price: AdminModelPrice) => void; onEditModel: (model: AdminChannelModel) => void; onChanged: () => Promise<void> }) {
        if (!channel.models.length) return <p className="px-2 py-1 text-sm text-stone-500">{t("admin.channels.noModels")}</p>;

        return (
            <div className="flex flex-col gap-3">
                {channel.models.map((model) => (
                    <Card key={model.id} size="small" title={<span className="flex items-center gap-2 text-sm">{model.displayName || model.name}<Tag>{t(`settingsPanels.model.capabilities.${model.capability}`)}</Tag>{model.hasScript ? <Tag color="purple">{t("admin.channels.hasScript")}</Tag> : null}{model.enabled ? null : <Tag>{t("admin.channels.off")}</Tag>}</span>}
                        extra={
                            <Space size={4}>
                                <Button size="small" type="text" onClick={() => onEditModel(model)}>
                                    {t("common.edit")}
                                </Button>
                                <Button size="small" type="text" onClick={() => onAddPrice(model.id)}>
                                    {t("admin.channels.addPrice")}
                                </Button>
                                <Popconfirm title={t("admin.channels.deleteModelConfirm")} onConfirm={() => void adminApi.deleteModel(model.id).then(onChanged)}>
                                    <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} />
                                </Popconfirm>
                            </Space>
                        }
                    >
                        {model.prices.length ? (
                            <div className="flex flex-wrap gap-2">
                                {model.prices.map((price) => (
                                    <button key={price.id} type="button" onClick={() => onEditPrice(model.id, price)} className="rounded-md border border-stone-200 px-2 py-1 text-left text-xs hover:bg-black/5 dark:border-stone-800 dark:hover:bg-white/10">
                                        <span className="font-medium">¥{formatMoney(price.unitPrice)}</span>
                                        <span className="text-stone-500">
                                            {" "}
                                            {t(`admin.channels.billing.${price.billingMode}`)}
                                            {price.spec ? ` · ${price.spec}` : ` · ${t("admin.channels.defaultSpec")}`}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            // A model with no price cannot be billed, so the server hides it from users.
                            <p className="text-xs text-amber-600">{t("admin.channels.noPriceWarning")}</p>
                        )}
                        {model.capability === "image" && model.features ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                                <Tag>{model.features.resolutions.join(" / ")}</Tag>
                                <Tag>{model.features.maxCount <= 1 ? t("admin.channels.batchOne") : t("admin.channels.batchN", { count: model.features.maxCount })}</Tag>
                                {model.features.supportsTransparent ? <Tag>{t("admin.channels.transparentOn")}</Tag> : null}
                                <Tag>{(model.features.aspectPresets ?? []).map((item) => item.ratio).filter((item) => item !== "auto").join(" / ") || model.features.aspectRatios.filter((item) => item !== "auto").join(" / ")}</Tag>
                            </div>
                        ) : null}
                        {model.capability === "video" && model.features ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                                <Tag>{model.features.videoResolutions.map((item) => `${item}p`).join(" / ")}</Tag>
                                <Tag>{t("admin.channels.maxSecondsTag", { count: model.features.maxSeconds })}</Tag>
                                <Tag>{(model.features.aspectPresets ?? []).map((item) => item.ratio).filter((item) => item !== "auto").join(" / ") || model.features.aspectRatios.filter((item) => item !== "auto").join(" / ")}</Tag>
                            </div>
                        ) : null}
                    </Card>
                ))}
            </div>
        );
    }

    function ChannelModal({ target, onClose, onSaved }: { target: AdminChannel | "new" | null; onClose: () => void; onSaved: () => Promise<void> }) {
        const [form] = Form.useForm();
        const [saving, setSaving] = useState(false);
        const isNew = target === "new";
        const channel = isNew ? null : target;
        const apiFormat = Form.useWatch("apiFormat", form);

        const submit = async () => {
            const values = await form.validateFields();
            setSaving(true);
            try {
                const body = { ...values, apiKey: values.apiKey || undefined };
                if (channel) await adminApi.updateChannel(channel.id, body);
                else await adminApi.createChannel(body);
                message.success(t("admin.channels.saved"));
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
                open={Boolean(target)}
                title={t(isNew ? "admin.channels.create" : "admin.channels.editTitle")}
                onCancel={onClose}
                onOk={() => void submit()}
                confirmLoading={saving}
                destroyOnHidden
                afterOpenChange={(open) => open && form.setFieldsValue(channel ? { ...channel, apiKey: "" } : { name: "", baseUrl: "https://api.openai.com", apiFormat: "openai", apiKey: "", enabled: true, priority: 100 })}
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="name" label={t("admin.channels.name")} rules={[{ required: true }]}>
                        <Input maxLength={128} />
                    </Form.Item>
                    <Form.Item name="apiFormat" label={t("admin.channels.protocol")} rules={[{ required: true }]}>
                        <Select
                            options={[{ value: "openai", label: "OpenAI" }, { value: "gemini", label: "Gemini" }, { value: "piapi", label: "PiAPI" }]}
                            onChange={(value) => {
                                if (value !== "piapi") return;
                                const currentName = String(form.getFieldValue("name") || "");
                                const currentUrl = String(form.getFieldValue("baseUrl") || "");
                                form.setFieldsValue({
                                    name: currentName || "PiAPI",
                                    baseUrl: !currentUrl || /openai|googleapis/i.test(currentUrl) ? PIAPI_BASE_URL : currentUrl,
                                    priority: form.getFieldValue("priority") === 100 ? 1 : form.getFieldValue("priority"),
                                });
                            }}
                        />
                    </Form.Item>
                    <Form.Item name="baseUrl" label={t("admin.channels.baseUrl")} rules={[{ required: true }]}>
                        <Input maxLength={500} />
                    </Form.Item>
                    {apiFormat === "piapi" ? (
                        <p className="mb-4 text-xs text-stone-500">
                            {t("admin.channels.usesPoolHint")}{" "}
                            <Link to="/admin/piapi" className="underline">
                                {t("admin.piapi.title")}
                            </Link>
                        </p>
                    ) : (
                        <Form.Item name="apiKey" label={t("admin.channels.apiKey")} extra={t("admin.channels.apiKeyHint")}>
                            <Input.Password autoComplete="off" placeholder={channel?.hasApiKey ? "••••••••" : ""} />
                        </Form.Item>
                    )}
                    <Space size="large">
                        <Form.Item name="priority" label={t("admin.channels.priority")} extra={t("admin.channels.priorityHint")}>
                            <InputNumber min={0} max={10000} />
                        </Form.Item>
                        <Form.Item name="enabled" label={t("admin.channels.enabled")} valuePropName="checked">
                            <Switch />
                        </Form.Item>
                    </Space>
                </Form>
            </Modal>
        );
    }

    function ModelModal({ target, onClose, onSaved }: { target: { channelId: string; model?: AdminChannelModel } | null; onClose: () => void; onSaved: () => Promise<void> }) {
        const [form] = Form.useForm();
        const [saving, setSaving] = useState(false);
        const isPiapi = channels.find((item) => item.id === target?.channelId)?.apiFormat === "piapi";
        const capability = Form.useWatch("capability", form);

        const submit = async () => {
            if (!target) return;
            const values = await form.validateFields();
            setSaving(true);
            try {
                await adminApi.upsertModel(target.channelId, values);
                message.success(t("admin.channels.saved"));
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
                open={Boolean(target)}
                width={960}
                title={t(target?.model ? "admin.channels.editModel" : "admin.channels.addModel")}
                onCancel={onClose}
                onOk={() => void submit()}
                confirmLoading={saving}
                destroyOnHidden
                styles={{ body: { maxHeight: "70vh", overflowY: "auto" } }}
                afterOpenChange={(open) => {
                    if (!open) return;
                    const features = target?.model?.features;
                    const capability = target?.model?.capability ?? "image";
                    const aspectPresets = features
                        ? parseAspectPresets(features.aspectPresets, features.aspectRatios)
                        : isPiapi
                          ? piapiAspectPresets("pro")
                          : capability === "video"
                            ? defaultVideoAspectPresets()
                            : defaultAspectPresets();
                    form.setFieldsValue({
                        name: target?.model?.name ?? "",
                        displayName: target?.model?.displayName ?? "",
                        capability,
                        enabled: target?.model?.enabled ?? true,
                        script: "",
                        features: {
                            ...DEFAULT_MODEL_FEATURES,
                            ...features,
                            aspectPresets,
                        },
                    });
                }}
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="name" label={t("admin.channels.modelName")} extra={t("admin.channels.modelNameHint")} rules={[{ required: true }]}>
                        {isPiapi ? (
                            <Select
                                disabled={Boolean(target?.model)}
                                options={PIAPI_SEEDREAM_TASK_TYPES.map((name) => ({ value: name, label: `${PIAPI_SEEDREAM_LABELS[name]} (${name})` }))}
                                onChange={(name: (typeof PIAPI_SEEDREAM_TASK_TYPES)[number]) =>
                                    form.setFieldsValue({
                                        displayName: PIAPI_SEEDREAM_LABELS[name],
                                        capability: "image",
                                        features: {
                                            ...form.getFieldValue("features"),
                                            aspectPresets: piapiAspectPresets(name.includes("lite") ? "lite" : "pro"),
                                        },
                                    })
                                }
                            />
                        ) : (
                            <Input maxLength={128} disabled={Boolean(target?.model)} />
                        )}
                    </Form.Item>
                    <Form.Item name="displayName" label={t("admin.channels.displayName")}>
                        <Input maxLength={128} />
                    </Form.Item>
                    <Space size="large">
                        <Form.Item name="capability" label={t("admin.channels.capability")} rules={[{ required: true }]}>
                            <Select style={{ width: 160 }} options={capabilityOptions.map((value) => ({ value, label: t(`settingsPanels.model.capabilities.${value}`) }))} />
                        </Form.Item>
                        <Form.Item name="enabled" label={t("admin.channels.enabled")} valuePropName="checked">
                            <Switch />
                        </Form.Item>
                    </Space>
                    {capability === "image" ? (
                        <>
                            <Form.Item name={["features", "resolutions"]} label={t("admin.channels.resolutions")} extra={t("admin.channels.resolutionsHint")} rules={[{ type: "array", min: 1, message: t("admin.channels.resolutionsRequired") }]}>
                                <Checkbox.Group options={IMAGE_RESOLUTIONS.map((value) => ({ value, label: value }))} />
                            </Form.Item>
                            <Space size="large" align="start">
                                <Form.Item name={["features", "maxCount"]} label={t("admin.channels.maxCount")} extra={t("admin.channels.maxCountHint")}>
                                    <InputNumber min={1} max={15} />
                                </Form.Item>
                                <Form.Item name={["features", "supportsTransparent"]} label={t("admin.channels.supportsTransparent")} extra={t("admin.channels.supportsTransparentHint")} valuePropName="checked">
                                    <Switch />
                                </Form.Item>
                            </Space>
                        </>
                    ) : null}
                    {capability === "video" ? (
                        <>
                            <Form.Item name={["features", "videoResolutions"]} label={t("admin.channels.videoResolutions")} extra={t("admin.channels.videoResolutionsHint")}>
                                <Select mode="tags" tokenSeparators={[","]} options={[{ value: "480", label: "480p" }, { value: "720", label: "720p" }, { value: "1080", label: "1080p" }, { value: "2160", label: "4K" }]} />
                            </Form.Item>
                            <Form.Item name={["features", "maxSeconds"]} label={t("admin.channels.maxSeconds")} extra={t("admin.channels.maxSecondsHint")}>
                                <InputNumber min={1} max={600} />
                            </Form.Item>
                        </>
                    ) : null}
                    {capability === "image" || capability === "video" ? (
                        <Form.Item label={t("admin.channels.aspectPresets")} extra={t("admin.channels.aspectPresetsHint")} required>
                            <AspectPresetEditor variant={isPiapi ? "piapi" : capability === "video" ? "video" : "image"} />
                        </Form.Item>
                    ) : null}
                    <Form.Item name="script" label={t("admin.channels.script")} extra={t("admin.channels.scriptHint")}>
                        <Input.TextArea rows={8} className="font-mono text-xs" />
                    </Form.Item>
                </Form>
            </Modal>
        );
    }

    function PriceModal({ target, onClose, onSaved }: { target: { modelId: string; price?: AdminModelPrice } | null; onClose: () => void; onSaved: () => Promise<void> }) {
        const [form] = Form.useForm();
        const [saving, setSaving] = useState(false);

        const submit = async () => {
            if (!target) return;
            const values = await form.validateFields();
            setSaving(true);
            try {
                await adminApi.upsertPrice(target.modelId, { ...values, spec: values.spec?.trim() || undefined });
                message.success(t("admin.channels.saved"));
                await onSaved();
                onClose();
            } catch (error) {
                message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
            } finally {
                setSaving(false);
            }
        };

        const removePrice = async () => {
            if (!target?.price) return;
            await adminApi.deletePrice(target.price.id);
            await onSaved();
            onClose();
        };

        return (
            <Modal
                open={Boolean(target)}
                title={t("admin.channels.priceTitle")}
                onCancel={onClose}
                confirmLoading={saving}
                destroyOnHidden
                afterOpenChange={(open) => open && form.setFieldsValue(target?.price ? { ...target.price, spec: target.price.spec ?? "" } : { billingMode: "per_image", spec: "", unitPrice: "", extraReferencePrice: "0", minCharge: "0" })}
                footer={
                    <Space>
                        {target?.price ? (
                            <Popconfirm title={t("admin.channels.deletePriceConfirm")} onConfirm={() => void removePrice()}>
                                <Button danger>{t("common.delete")}</Button>
                            </Popconfirm>
                        ) : null}
                        <Button onClick={onClose}>{t("common.cancel")}</Button>
                        <Button type="primary" loading={saving} onClick={() => void submit()}>
                            {t("common.save")}
                        </Button>
                    </Space>
                }
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="billingMode" label={t("admin.channels.billingMode")} extra={t("admin.channels.billingModeHint")} rules={[{ required: true }]}>
                        <Select options={billingOptions.map((value) => ({ value, label: t(`admin.channels.billing.${value}`) }))} />
                    </Form.Item>
                    <Form.Item name="spec" label={t("admin.channels.spec")} extra={t("admin.channels.specHint")}>
                        <Input maxLength={32} placeholder="1K / 2K" />
                    </Form.Item>
                    <Form.Item name="unitPrice" label={t("admin.channels.unitPrice")} rules={[{ required: true }, { pattern: /^\d{1,12}(\.\d{1,6})?$/, message: t("admin.channels.priceInvalid") }]}>
                        <Input placeholder="0.30" autoComplete="off" />
                    </Form.Item>
                    <Form.Item name="extraReferencePrice" label={t("admin.channels.extraReference")} extra={t("admin.channels.extraReferenceHint")} rules={[{ pattern: /^\d{1,12}(\.\d{1,6})?$/, message: t("admin.channels.priceInvalid") }]}>
                        <Input placeholder="0" autoComplete="off" />
                    </Form.Item>
                    <Form.Item name="minCharge" label={t("admin.channels.minCharge")} rules={[{ pattern: /^\d{1,12}(\.\d{1,6})?$/, message: t("admin.channels.priceInvalid") }]}>
                        <Input placeholder="0" autoComplete="off" />
                    </Form.Item>
                </Form>
            </Modal>
        );
    }
}
