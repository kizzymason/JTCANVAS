import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ConfigProvider, Select, Switch } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { defaultAspectPresets, parsePixelSize, presetSizeForQuality } from "@/lib/aspect-presets";
import { migrateLegacyImageSize, modelFeaturesOf, normalizeImageResolution } from "@/lib/model-features";
import type { AiConfig } from "@/stores/use-config-store";
import { normalizeModelOptionValue } from "@/stores/use-config-store";
import { useModelStore } from "@/stores/use-model-store";

const DIMENSION_STEP = 16;

export const imageQualityOptions = [
    { value: "auto", get label() { return i18n.t("settingsPanels.common.auto"); } },
    { value: "1K", label: "1K" },
    { value: "2K", label: "2K" },
    { value: "4K", label: "4K" },
];
export const imageAspectOptions = defaultAspectPresets().map((item) => ({ value: item.ratio, label: item.label }));

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "count" | "background", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    modelValue?: string;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", modelValue }: ImageSettingsPanelProps) {
    const { t } = useTranslation();
    const models = useModelStore((state) => state.models);
    const selectedValue = normalizeModelOptionValue(modelValue || config.model || config.imageModel, models);
    const selectedModel = models.find((item) => item.value === selectedValue && item.capability === "image");
    const features = useMemo(() => modelFeaturesOf(selectedModel), [selectedModel]);
    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);

    const resolution = useMemo(() => {
        const current = normalizeImageResolution(config.quality);
        if (current !== "auto" && !features.resolutions.includes(current)) return features.resolutions[0] || "auto";
        return current;
    }, [config.quality, features.resolutions]);

    const maxCount = features.maxCount;
    const count = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
    const migratedSize = migrateLegacyImageSize(config.size || "auto");
    const activeSize = migratedSize.size || "auto";
    const transparentBackground = config.background === "transparent";
    const visibleAspects = features.aspectPresets;
    const selectedAspect = visibleAspects.find((item) => item.ratio === activeSize);
    const qualityForPixels = resolution === "auto" ? "1K" : resolution;
    const dimensions = readSizeDimensions(activeSize, selectedAspect ? parsePixelSize(presetSizeForQuality(selectedAspect, qualityForPixels) || "") : { width: 1024, height: 1024 });
    const resolutionOptions = [{ value: "auto" as const }, ...features.resolutions.map((value) => ({ value }))];
    const countOptions = Array.from({ length: maxCount }, (_, index) => {
        const value = index + 1;
        return { value: String(value), label: t("settingsPanels.image.images", { count: value }) };
    });

    useEffect(() => {
        const nextQuality = resolution === "auto" ? "auto" : resolution;
        if (nextQuality !== (config.quality || "auto")) {
            onConfigChange("quality", nextQuality);
            return;
        }
        if (migratedSize.qualityHint && nextQuality === "auto" && features.resolutions.includes(migratedSize.qualityHint)) {
            onConfigChange("quality", migratedSize.qualityHint);
            return;
        }

        const isCustomPixels = /^\d+\s*[x×*]\s*\d+$/i.test(migratedSize.size);
        let nextSize = migratedSize.size || "auto";
        if (!isCustomPixels && nextSize !== "auto" && !features.aspectRatios.includes(nextSize)) nextSize = features.aspectRatios[0] || "auto";
        if (nextSize !== (config.size || "auto")) {
            onConfigChange("size", nextSize);
            return;
        }

        const rawCount = Math.max(1, Math.floor(Math.abs(Number(config.count)) || 1));
        if (rawCount !== count) {
            onConfigChange("count", String(count));
            return;
        }
        if (transparentBackground && !features.supportsTransparent) onConfigChange("background", "");
    }, [config.count, config.quality, config.size, count, features.aspectRatios, features.resolutions, features.supportsTransparent, migratedSize.qualityHint, migratedSize.size, onConfigChange, resolution, transparentBackground]);

    const selectAspect = (value: string) => onConfigChange("size", value || "auto");
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 1024));
        const width = key === "width" ? next : dimensions.width;
        const height = key === "height" ? next : dimensions.height;
        onConfigChange("size", `${alignDimension(width, snapDimensionToStep)}x${alignDimension(height, snapDimensionToStep)}`);
    };
    const commitCount = (raw: string) => {
        const match = String(raw).match(/\d+/);
        const parsed = match ? Math.floor(Number(match[0])) : 1;
        onConfigChange("count", String(Math.max(1, Math.min(maxCount, Number.isFinite(parsed) ? parsed : 1))));
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.image.title")}</div> : null}
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.resolution")}</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                {item.value === "auto" ? t("settingsPanels.common.auto") : item.value}
                            </OptionPill>
                        ))}
                    </div>
                </div>
                <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                        <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.size")}</SettingTitle>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                {t("settingsPanels.image.align16")}
                            </span>
                            <span title={t("settingsPanels.image.align16Hint")} onMouseDown={(event) => event.stopPropagation()}>
                                <Switch size="small" checked={snapDimensionToStep} onChange={setSnapDimensionToStep} />
                            </span>
                        </div>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={activeSize === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={activeSize === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("height", value)} />
                    </div>
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.aspectRatio")}</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {visibleAspects.map((item) => {
                            const preview = parsePixelSize(presetSizeForQuality(item, qualityForPixels) || "") || { width: 0, height: 0 };
                            return (
                            <button
                                key={item.ratio}
                                type="button"
                                className="flex h-[78px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: selectedAspect?.ratio === item.ratio ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => selectAspect(item.ratio)}
                            >
                                <AspectIcon type={item.ratio === "auto" ? "auto" : "box"} width={preview.width} height={preview.height} color={theme.node.text} />
                                <span>{item.label || item.ratio}</span>
                                {item.ratio === "auto" || !preview.width ? null : (
                                    <span className="text-[11px] leading-none opacity-55">
                                        {preview.width}x{preview.height}
                                    </span>
                                )}
                            </button>
                            );
                        })}
                    </div>
                </div>
                {features.supportsTransparent ? (
                    <div className="flex items-center justify-between gap-3">
                        <div className="space-y-0.5">
                            <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.transparent")}</SettingTitle>
                            <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                                {t("settingsPanels.image.transparentHint")}
                            </div>
                        </div>
                        <span onMouseDown={(event) => event.stopPropagation()}>
                            <Switch size="small" checked={transparentBackground} onChange={(checked) => onConfigChange("background", checked ? "transparent" : "")} />
                        </span>
                    </div>
                ) : null}
                <div className="space-y-2.5" onMouseDown={(event) => event.stopPropagation()}>
                    <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.count")}</SettingTitle>
                    <Select
                        showSearch
                        disabled={maxCount <= 1}
                        className="w-full"
                        value={String(count)}
                        options={countOptions}
                        optionFilterProp="value"
                        placeholder={t("settingsPanels.image.countPlaceholder")}
                        onChange={(value) => commitCount(String(value))}
                        onBlur={(event) => {
                            const raw = (event.target as HTMLInputElement).value;
                            if (raw?.trim()) commitCount(raw);
                        }}
                        getPopupContainer={() => document.body}
                        styles={{ popup: { root: { zIndex: 1400 } } }}
                    />
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel, zIndexPopupBase: 1400 },
                components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    const current = normalizeImageResolution(value);
    return current === "auto" ? i18n.t("settingsPanels.common.auto") : current;
}

export function imageSizeLabel(size: string) {
    const migrated = migrateLegacyImageSize(size);
    const preset = defaultAspectPresets().find((item) => item.ratio === migrated.size);
    return preset?.label || migrated.size;
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function DimensionInput({ prefix, value, disabled, theme, alignToStep, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; alignToStep: boolean; onChange: (value: number | null) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = alignDimension(Math.max(1, Math.floor(Number(input.value) || value || 1024)), alignToStep);
        input.value = String(next);
        onChange(next);
    };

    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                type="number"
                min={1}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value || ""}
                key={`${prefix}-${value}`}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function AspectIcon({ type, width, height, color }: { type: string; width: number; height: number; color: string }) {
    if (type === "auto") return null;
    const ratio = width / Math.max(1, height);
    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
    return (
        <span className="grid h-7 w-9 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function readSizeDimensions(size: string, fallback: { width: number; height: number } | null) {
    const match = size?.match(/^(\d+)x(\d+)$/);
    return {
        width: match ? Number(match[1]) : fallback?.width || 0,
        height: match ? Number(match[2]) : fallback?.height || 0,
    };
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}
