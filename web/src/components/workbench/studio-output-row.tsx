import { Drawer, Popover } from "antd";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import { ImageSettingsPanel, imageQualityLabel, imageSizeLabel } from "@/components/image-settings-panel";
import { VideoSettingsPanel, videoResolutionLabel, videoSecondsLabel, videoSizeLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useFrontendThemeStore } from "@/stores/use-frontend-theme-store";
import type { StudioKind } from "@/stores/use-generation-workbench-store";
import styles from "./workbench.module.css";

/**
 * 输出参数收成一行摘要：桌面端点开是浮层，移动端点开是底部弹出面板。
 * 移动端不再复用桌面那套宽浮层（宽 560px、比例卡片一行 6 个），否则在窄屏上必然显示异常。
 */
export function StudioOutputRow({ kind }: { kind: StudioKind }) {
    const config = useEffectiveConfig();
    const update = useConfigStore((state) => state.updateConfig);
    const theme = canvasThemes[useFrontendThemeStore((state) => state.theme)];
    const model = (kind === "image" ? config.imageModel : config.videoModel) || config.model;
    const [open, setOpen] = useState(false);
    const [mobile, setMobile] = useState(false);
    const summary = kind === "image"
        ? [imageQualityLabel(config.quality), config.size === "auto" ? "自动比例" : imageSizeLabel(config.size), `${config.count || "1"} 张`, config.background === "transparent" ? "透明背景" : ""].filter(Boolean).join(" · ")
        : [videoSecondsLabel(config.videoSeconds), videoResolutionLabel(config.vquality), videoSizeLabel(config.size), config.videoGenerateAudio === "true" ? "有声" : "静音"].filter(Boolean).join(" · ");

    useEffect(() => {
        const query = window.matchMedia("(max-width: 767px)");
        const sync = () => setMobile(query.matches);
        sync();
        query.addEventListener("change", sync);
        return () => query.removeEventListener("change", sync);
    }, []);

    const panel = kind === "image"
        ? <ImageSettingsPanel config={config} onConfigChange={update} theme={theme} showTitle={false} className={mobile ? styles.outputSheet : styles.outputPanel} modelValue={model} />
        : <VideoSettingsPanel config={config} onConfigChange={update} theme={theme} showTitle={false} className={mobile ? styles.outputSheet : styles.outputPanel} modelValue={model} />;
    const trigger = <button type="button" className={styles.outputRow} aria-label={`输出设置：${summary}`} onClick={() => setOpen(true)}>
        <SlidersHorizontal size={14} className={styles.outputRowIcon} />
        <span className={styles.outputRowValue}>{summary}</span>
        <ChevronDown size={15} className={styles.outputRowChevron} />
    </button>;

    return <div className={styles.field}>
        <div className={styles.label}>输出</div>
        {mobile ? <>
            {trigger}
            <Drawer placement="bottom" height="auto" open={open} onClose={() => setOpen(false)} title="输出设置"
                styles={{ body: { padding: "10px 14px 16px" }, wrapper: { maxHeight: "86dvh" } }}>
                {panel}
            </Drawer>
        </> : <Popover trigger="click" placement="bottomLeft" arrow={false} styles={{ body: { padding: "12px 12px 13px" } }} content={panel}>
            {trigger}
        </Popover>}
    </div>;
}
