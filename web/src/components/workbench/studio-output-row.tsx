import { Drawer, Popover } from "antd";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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

    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const [placement, setPlacement] = useState<"topLeft" | "bottomLeft">("topLeft");
    const [room, setRoom] = useState(0);

    /**
     * 输出面板在视频工作台有 450px 左右高。若一律向上弹，窗口不够高时顶部会跑到浏览器上沿之外，
     * 把最上面的 480P / 720P / 1080P 分辨率选择切掉。打开前先量一下触发按钮上下各有多少空间，
     * 选空间更大的一侧，并把面板最大高度限制在该侧可用高度内（放不下时才内部滚动）。
     */
    const measure = useCallback(() => {
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const below = window.innerHeight - rect.bottom - 14;
        const above = rect.top - 14;
        const next = above > below ? "topLeft" : "bottomLeft";
        setPlacement(next);
        setRoom(Math.max(240, Math.floor(next === "topLeft" ? above : below)));
    }, []);

    /**
     * antd 在上下空间不足时会把浮层整体上推，可能直接推出视口（外层还是 overflow:hidden，
     * 于是最上面的清晰度选择被切掉）。渲染后按实际矩形把它拉回视口内。
     * 注意：antd 写的内联 top 是 "auto"，直接 parseFloat 会得到 NaN、赋值被忽略，必须按矩形差值来算。
     */
    const clampPopup = useCallback(() => {
        const pop = document.querySelector<HTMLElement>(".ant-popover:not(.ant-popover-hidden)");
        if (!pop) return;
        const margin = 10;
        const rect = pop.getBoundingClientRect();
        if (rect.top >= margin && rect.bottom <= window.innerHeight - margin) return;
        const delta = rect.top < margin ? margin - rect.top : window.innerHeight - margin - rect.bottom;
        const current = Number.parseFloat(pop.style.top);
        const base = Number.isFinite(current) ? current : rect.top + window.scrollY;
        pop.style.top = `${base + delta}px`;
    }, []);

    useEffect(() => {
        if (!open) return;
        measure();
        const timers = [0, 80, 240, 600].map((delay) => window.setTimeout(clampPopup, delay));
        const onResize = () => { measure(); clampPopup(); };
        window.addEventListener("resize", onResize);
        return () => { timers.forEach((timer) => window.clearTimeout(timer)); window.removeEventListener("resize", onResize); };
    }, [open, measure, clampPopup]);

    const panel = kind === "image"
        ? <ImageSettingsPanel config={config} onConfigChange={update} theme={theme} showTitle={false} className={mobile ? styles.outputSheet : styles.outputPanel} modelValue={model} />
        : <VideoSettingsPanel config={config} onConfigChange={update} theme={theme} showTitle={false} className={mobile ? styles.outputSheet : styles.outputPanel} modelValue={model} />;
    const trigger = <button ref={triggerRef} type="button" className={styles.outputRow} aria-label={`输出设置：${summary}`} onClick={() => { measure(); setOpen(true); }}>
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
        </> : <Popover trigger="click" placement={placement} arrow={false}
            autoAdjustOverflow={{ adjustX: 1, adjustY: 0 }}
            styles={{ body: { padding: "12px 12px 13px", maxHeight: room || undefined, overflowY: "auto" } }} content={panel}>
            {trigger}
        </Popover>}
    </div>;
}
