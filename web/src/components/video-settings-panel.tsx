import { type ReactNode, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { defaultAspectPresets, parsePixelSize, presetSizeForQuality } from "@/lib/aspect-presets";
import { modelFeaturesOf } from "@/lib/model-features";
import { type AiConfig } from "@/stores/use-config-store";
import { normalizeModelOptionValue } from "@/stores/use-config-store";
import { useModelStore } from "@/stores/use-model-store";
import { hasVideoInputPricing, videoPricingSpecFor } from "@/lib/video-pricing-spec";
import { formatMoney } from "@/services/api/models";

const defaultResolutionOptions = [
    { value: "720", label: "720p" },
    { value: "480", label: "480p" },
];

const secondOptions = [6, 10, 12, 16, 20];

export const videoResolutionOptions = defaultResolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = defaultAspectPresets().map((item) => ({ value: item.ratio, label: item.label }));
export const videoSecondOptions = secondOptions.map((value) => String(value));

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    modelValue?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", modelValue }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const models = useModelStore((state) => state.models);
    const selectedValue = normalizeModelOptionValue(modelValue || config.model || config.videoModel, models);
    const selectedModel = models.find((item) => item.value === selectedValue && item.capability === "video");
    const features = useMemo(() => modelFeaturesOf(selectedModel), [selectedModel]);
    const resolutionOptions = useMemo(() => {
        const values = features.videoResolutions.length ? features.videoResolutions : defaultResolutionOptions.map((item) => item.value);
        return values.map((value) => ({ value, label: value === "2160" ? "4K" : `${value}p` }));
    }, [features.videoResolutions]);
    const visibleSecondOptions = secondOptions.filter((value) => value <= features.maxSeconds);
    const seconds = String(Math.min(features.maxSeconds, Math.max(1, Number(config.videoSeconds) || 6)));
    const size = normalizeVideoSizeValue(config.size, features.aspectPresets);
    const selectedPreset = features.aspectPresets.find((item) => item.ratio === size);
    const presetPixels = selectedPreset ? parsePixelSize(presetSizeForQuality(selectedPreset, "1K") || "") : null;
    const dimensions = readSizeDimensions(size, presetPixels);
    const resolution = useMemo(() => {
        const current = normalizeVideoResolutionValue(config.vquality);
        return resolutionOptions.some((item) => item.value === current) ? current : resolutionOptions[0]?.value || current;
    }, [config.vquality, resolutionOptions]);
    const videoRates = useMemo(() => {
        if (!selectedModel || selectedModel.billingMode !== "per_second" || !hasVideoInputPricing(selectedModel.specPrices)) return null;
        const without = selectedModel.specPrices[videoPricingSpecFor(resolution, false)] ?? selectedModel.unitPrice;
        const withVideo = selectedModel.specPrices[videoPricingSpecFor(resolution, true)] ?? without;
        return { without: formatMoney(without), with: formatMoney(withVideo) };
    }, [resolution, selectedModel]);
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
        onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
    };

    useEffect(() => {
        if (resolution !== normalizeVideoResolutionValue(config.vquality)) onConfigChange("vquality", resolution);
        const rawSeconds = Math.max(1, Number(config.videoSeconds) || 6);
        if (rawSeconds > features.maxSeconds) onConfigChange("videoSeconds", String(features.maxSeconds));
        const allowed = new Set(features.aspectPresets.map((item) => item.ratio));
        const isCustomPixels = /^\d+x\d+$/.test(size);
        if (!isCustomPixels && size !== "auto" && allowed.size && !allowed.has(size)) {
            onConfigChange("size", features.aspectPresets[0]?.ratio || "auto");
        }
    }, [config.videoSeconds, config.vquality, features.aspectPresets, features.maxSeconds, onConfigChange, resolution, size]);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                <SettingGroup title={t("settingsPanels.video.quality")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                    {videoRates ? (
                        <div className="text-[11px] leading-4 opacity-70">
                            {t("pricing.videoRateHint", { without: videoRates.without, with: videoRates.with })}
                        </div>
                    ) : null}
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.size")} color={theme.node.muted}>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("height", value)} />
                    </div>
                    <div className="grid grid-cols-4 gap-2.5">
                        {features.aspectPresets.map((item) => {
                            const preview = parsePixelSize(presetSizeForQuality(item, "1K") || "") || { width: 0, height: 0 };
                            return (
                            <button
                                key={item.ratio}
                                type="button"
                                className="flex h-[78px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: size === item.ratio ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.ratio)}
                            >
                                <SizePreview width={preview.width} height={preview.height} color={theme.node.text} />
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
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.seconds")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {visibleSecondOptions.map((value) => (
                            <OptionPill key={value} selected={seconds === String(value)} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value}s
                            </OptionPill>
                        ))}
                        <NumberInput value={seconds} min={1} max={features.maxSeconds} theme={theme} onChange={(value) => onConfigChange("videoSeconds", String(Math.min(features.maxSeconds, Math.max(1, Number(value) || 1))))} />
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    const resolution = normalizeVideoResolutionValue(value);
    return resolution === "2160" ? "4K" : `${resolution}p`;
}

export function videoSizeLabel(value: string) {
    if (value === "adaptive" || value === "auto") return i18n.t("settingsPanels.video.adaptive");
    const size = normalizeVideoSizeValue(value);
    const option = defaultAspectPresets().find((item) => item.ratio === size);
    return option?.label || size;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return i18n.t("settingsPanels.video.smart");
    return `${value || "6"}s`;
}

export function normalizeVideoSizeValue(value: string, presets = defaultAspectPresets()) {
    if (value === "auto" || value === "adaptive") return "auto";
    const trimmed = (value || "").trim();
    if (presets.some((item) => item.ratio === trimmed)) return trimmed;
    if (/^\d+x\d+$/.test(trimmed)) {
        const matched = presets.find((item) => Object.values(item.sizes).includes(trimmed) || presetSizeForQuality(item, "1K") === trimmed);
        if (matched) return matched.ratio;
        return trimmed;
    }
    if (["9:16", "2:3", "3:4"].includes(trimmed)) return trimmed;
    if (trimmed === "1280x720") return "16:9";
    if (trimmed === "720x1280") return "9:16";
    if (trimmed === "1024x1024") return "1:1";
    return trimmed || "16:9";
}

export function normalizeVideoResolutionValue(value: string) {
    if (value === "480p" || value === "low") return "480";
    if (value === "720p" || value === "auto" || value === "high" || value === "medium") return "720";
    if (value === "4k" || value === "4K" || value === "2160p") return "2160";
    return value.replace(/p$/i, "") || "720";
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </label>
    );
}

function NumberInput({ value, min, max, theme, onChange }: { value: string; min: number; max: number; theme: CanvasTheme; onChange: (value: string) => void }) {
    return <input type="number" min={min} max={max} className="h-9 rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }} value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />;
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function readSizeDimensions(size: string, fallback: { width: number; height: number } | null) {
    if (size === "auto") return { width: 0, height: 0 };
    const match = size.match(/^(\d+)x(\d+)$/);
    return { width: Number(match?.[1]) || fallback?.width || 1280, height: Number(match?.[2]) || fallback?.height || 720 };
}
