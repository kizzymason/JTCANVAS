import { Button, InputNumber, Modal, Select, Switch } from "antd";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { ModelPicker } from "@/components/model-picker";
import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { VideoSettingsPanel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { modelFeaturesOf } from "@/lib/model-features";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useFrontendThemeStore } from "@/stores/use-frontend-theme-store";
import { useModelStore } from "@/stores/use-model-store";
import type { StudioKind } from "@/stores/use-generation-workbench-store";
import styles from "./workbench.module.css";

export function StudioSettings({ kind }: { kind: StudioKind }) {
    const config = useEffectiveConfig();
    const update = useConfigStore((state) => state.updateConfig);
    const openConfig = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useFrontendThemeStore((state) => state.theme)];
    const model = (kind === "image" ? config.imageModel : config.videoModel) || config.model;
    const found = useModelStore((state) => state.models.find((item) => item.value === model || item.modelName === model));
    const features = modelFeaturesOf(found);
    const [advanced, setAdvanced] = useState(false);
    return <>
        <div className={styles.field}>
            <div className={styles.label}>生成模型 <Button type="text" size="small" icon={<SlidersHorizontal size={12} />} onClick={() => setAdvanced(true)}>更多设置</Button></div>
            <ModelPicker config={config} value={model} capability={kind} fullWidth onChange={(value) => update(kind === "image" ? "imageModel" : "videoModel", value)} onMissingConfig={() => openConfig(false)} />
        </div>
        <div className={styles.field}>
            <div className={styles.label}>画面比例 <span className={styles.muted}>{config.size}</span></div>
            <div className={styles.options}>{features.aspectPresets.map((item) => <button key={item.ratio} aria-pressed={config.size === item.ratio} onClick={() => update("size", item.ratio)}>{item.ratio === "auto" ? "自动" : item.ratio}</button>)}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
            <label className={styles.field}><span className={styles.label}>{kind === "image" ? "生成质量" : "分辨率"}</span>
                <Select aria-label="生成质量" value={kind === "image" ? config.quality : config.vquality.replace(/p$/, "")} onChange={(value) => update(kind === "image" ? "quality" : "vquality", value)}
                    options={kind === "image" ? [{ value: "auto", label: "自动" }, ...features.resolutions.map((value) => ({ value, label: value }))] : features.videoResolutions.map((value) => ({ value, label: `${value}p` }))} />
            </label>
            {kind === "image" ? <label className={styles.field}><span className={styles.label}>每任务张数</span><Select aria-label="每任务张数" value={config.count} onChange={(value) => update("count", value)} options={Array.from({ length: features.maxCount }, (_, index) => ({ value: String(index + 1), label: `${index + 1} 张` }))} /></label>
                : <label className={styles.field}><span className={styles.label}>视频时长（秒）</span><InputNumber aria-label="视频时长" className="!w-full" min={features.minSeconds} max={features.maxSeconds} precision={0} value={Number(config.videoSeconds)} onChange={(value) => { if (value !== null) update("videoSeconds", String(value)); }} /></label>}
        </div>
        {kind === "video" ? <>
            <div className={styles.options}>{[5, 10, 15].filter((seconds) => seconds >= features.minSeconds && seconds <= features.maxSeconds).map((seconds) => <button key={seconds} aria-pressed={config.videoSeconds === String(seconds)} onClick={() => update("videoSeconds", String(seconds))}>{seconds} 秒</button>)}</div>
            <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-medium">生成声音</p><p className="mt-1 text-[11px] text-muted-foreground">为画面添加匹配的声音</p></div><Switch aria-label="生成声音" checked={config.videoGenerateAudio === "true"} onChange={(checked) => update("videoGenerateAudio", String(checked))} /></div>
        </> : features.supportsTransparent ? <div className="flex items-center justify-between text-xs">透明背景<Switch aria-label="透明背景" checked={config.background === "transparent"} onChange={(checked) => update("background", checked ? "transparent" : "")} /></div> : null}
        <Modal open={advanced} onCancel={() => setAdvanced(false)} title="更多生成设置" footer={null} width={420} destroyOnHidden>
            {kind === "image" ? <ImageSettingsPanel config={config} onConfigChange={update} theme={theme} showTitle={false} className="space-y-4 py-4" modelValue={model} /> : <VideoSettingsPanel config={config} onConfigChange={update} theme={theme} showTitle={false} className="space-y-4 py-4" modelValue={model} />}
        </Modal>
    </>;
}
