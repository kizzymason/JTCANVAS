import { Button, Form, Input, Space } from "antd";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { DEFAULT_ASPECT_RATIO_ORDER, defaultAspectPresets, defaultSizesForRatio } from "@/lib/aspect-presets";

const PIXEL_PATTERN = /^\d+x\d+$/i;
const RATIO_PATTERN = /^(auto|\d+(\.\d+)?:\d+(\.\d+)?)$/i;

function optionalPixelRule(message: string) {
    return [
        {
            validator: async (_: unknown, value: string) => {
                const trimmed = String(value ?? "").trim();
                if (!trimmed) return;
                if (!PIXEL_PATTERN.test(trimmed)) return Promise.reject(new Error(message));
            },
        },
    ];
}

type PresetRow = { ratio?: string; label?: string; sizes?: Partial<Record<"1K" | "2K" | "4K", string>> };

export function AspectPresetEditor() {
    const { t } = useTranslation();
    const form = Form.useFormInstance();
    const rows = (Form.useWatch(["features", "aspectPresets"], form) as PresetRow[] | undefined) ?? [];
    const used = new Set(rows.map((item) => String(item?.ratio ?? "").trim()).filter(Boolean));
    const unusedDefaults = [...DEFAULT_ASPECT_RATIO_ORDER, "auto"].filter((ratio) => !used.has(ratio));

    const addRatio = (ratio: string) => {
        const list = [...((form.getFieldValue(["features", "aspectPresets"]) as PresetRow[] | undefined) ?? [])];
        if (list.some((item) => item?.ratio === ratio)) return;
        list.push({
            ratio,
            label: ratio,
            sizes: ratio.toLowerCase() === "auto" ? {} : defaultSizesForRatio(ratio),
        });
        form.setFieldValue(["features", "aspectPresets"], list);
    };

    const addCustom = () => {
        const list = [...((form.getFieldValue(["features", "aspectPresets"]) as PresetRow[] | undefined) ?? [])];
        list.push({ ratio: "", label: "", sizes: { "1K": "", "2K": "", "4K": "" } });
        form.setFieldValue(["features", "aspectPresets"], list);
    };

    return (
        <div className="space-y-2">
            <Form.List
                name={["features", "aspectPresets"]}
                rules={[
                    {
                        validator: async (_, value) => {
                            if (!Array.isArray(value) || value.length < 1) {
                                return Promise.reject(new Error(t("admin.channels.aspectPresetsRequired")));
                            }
                        },
                    },
                ]}
            >
                {(fields, { remove }, { errors }) => (
                    <div className="space-y-2">
                        <div className="grid grid-cols-[88px_88px_1fr_1fr_1fr_32px] items-center gap-1.5 text-xs text-stone-500">
                            <span>{t("admin.channels.aspectPresetRatio")}</span>
                            <span>{t("admin.channels.aspectPresetLabel")}</span>
                            <span>1K</span>
                            <span>2K</span>
                            <span>4K</span>
                            <span />
                        </div>
                        {fields.map((field) => {
                            const ratio = String(rows[field.name]?.ratio ?? "").trim();
                            const isAuto = ratio.toLowerCase() === "auto";
                            return (
                                <div key={field.key} className="grid grid-cols-[88px_88px_1fr_1fr_1fr_32px] items-start gap-1.5">
                                    <Form.Item
                                        name={[field.name, "ratio"]}
                                        className="mb-0"
                                        rules={[
                                            { required: true, message: t("admin.channels.aspectPresetRatioRequired") },
                                            { pattern: RATIO_PATTERN, message: t("admin.channels.aspectPresetRatioInvalid") },
                                            {
                                                validator: async (_, value) => {
                                                    const current = String(value ?? "").trim();
                                                    if (!current) return;
                                                    const list = (form.getFieldValue(["features", "aspectPresets"]) as PresetRow[] | undefined) ?? [];
                                                    const duplicates = list.filter((item, index) => String(item?.ratio ?? "").trim() === current && index !== field.name);
                                                    if (duplicates.length) return Promise.reject(new Error(t("admin.channels.aspectPresetDuplicate")));
                                                },
                                            },
                                        ]}
                                    >
                                        <Input placeholder="16:9" maxLength={16} />
                                    </Form.Item>
                                    <Form.Item name={[field.name, "label"]} className="mb-0">
                                        <Input placeholder={ratio || "16:9"} maxLength={32} />
                                    </Form.Item>
                                    <Form.Item
                                        name={[field.name, "sizes", "1K"]}
                                        className="mb-0"
                                        rules={
                                            isAuto
                                                ? []
                                                : [
                                                      { required: true, message: t("admin.channels.aspectPreset1KRequired") },
                                                      { pattern: PIXEL_PATTERN, message: t("admin.channels.aspectPresetSizeInvalid") },
                                                  ]
                                        }
                                    >
                                        <Input placeholder="1280x720" disabled={isAuto} maxLength={16} />
                                    </Form.Item>
                                    <Form.Item name={[field.name, "sizes", "2K"]} className="mb-0" rules={isAuto ? [] : optionalPixelRule(t("admin.channels.aspectPresetSizeInvalid"))}>
                                        <Input placeholder={t("admin.channels.aspectPreset2KPlaceholder")} disabled={isAuto} maxLength={16} />
                                    </Form.Item>
                                    <Form.Item name={[field.name, "sizes", "4K"]} className="mb-0" rules={isAuto ? [] : optionalPixelRule(t("admin.channels.aspectPresetSizeInvalid"))}>
                                        <Input placeholder={t("admin.channels.aspectPreset4KPlaceholder")} disabled={isAuto} maxLength={16} />
                                    </Form.Item>
                                    <Button type="text" danger className="px-0" icon={<Trash2 className="size-3.5" />} onClick={() => remove(field.name)} disabled={fields.length <= 1} />
                                </div>
                            );
                        })}
                        <Form.ErrorList errors={errors} />
                    </div>
                )}
            </Form.List>
            <Space wrap size={6}>
                {unusedDefaults.map((ratio) => (
                    <Button key={ratio} size="small" icon={<Plus className="size-3" />} onClick={() => addRatio(ratio)}>
                        {ratio}
                    </Button>
                ))}
                <Button size="small" onClick={addCustom}>
                    {t("admin.channels.aspectPresetAddCustom")}
                </Button>
                <Button size="small" icon={<RotateCcw className="size-3" />} onClick={() => form.setFieldValue(["features", "aspectPresets"], defaultAspectPresets())}>
                    {t("admin.channels.aspectPresetRestore")}
                </Button>
            </Space>
        </div>
    );
}
