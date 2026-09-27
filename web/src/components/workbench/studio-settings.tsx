import { useEffect, useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";

import { ModelBrandIcon } from "@/components/model-brand-icon";
import { ModelPickerModal } from "@/components/model-picker-modal";
import { StudioOutputRow } from "@/components/workbench/studio-output-row";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import type { StudioKind } from "@/stores/use-generation-workbench-store";
import { useModelStore } from "@/stores/use-model-store";
import styles from "./workbench.module.css";

export function useIsMobileModal() {
    const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
    useEffect(() => {
        const query = window.matchMedia("(max-width: 767px)");
        const handle = () => setMobile(query.matches);
        query.addEventListener("change", handle);
        return () => query.removeEventListener("change", handle);
    }, []);
    return mobile;
}

/**
 * 工作台左侧的参数区：只保留「生成模型」与「输出」两个入口。
 *
 * 模型选择不再是下拉框：点击后打开独立的模型选择弹窗（桌面居中、移动端底部弹出），
 * 弹窗里按后台维护的分组归类，并展示每个模型的介绍与标识。
 */
export function StudioSettings({ kind }: { kind: StudioKind }) {
    const config = useEffectiveConfig();
    const update = useConfigStore((state) => state.updateConfig);
    const openConfig = useConfigStore((state) => state.openConfigDialog);
    const models = useModelStore((state) => state.models);
    const loadModels = useModelStore((state) => state.load);
    const [open, setOpen] = useState(false);
    const mobile = useIsMobileModal();
    const model = (kind === "image" ? config.imageModel : config.videoModel) || config.model;
    const current = models.find((item) => item.value === model);
    const available = models.filter((item) => item.capability === kind);

    useEffect(() => { void loadModels(); }, [loadModels]);

    return <>
        <div className={styles.field}>
            <div className={styles.label}>生成模型</div>
            <button
                type="button"
                className={styles.modelTrigger}
                onClick={() => { if (!available.length) { openConfig(false); return; } setOpen(true); }}
            >
                <ModelBrandIcon model={current?.displayName || model} className="size-4" />
                <span className={styles.modelTriggerName}>{current?.displayName || model || "选择模型"}</span>
                <span className={styles.modelTriggerHint}><Sparkles size={12} />模型介绍</span>
                <ChevronRight size={14} className={styles.modelTriggerArrow} />
            </button>
        </div>
        <StudioOutputRow kind={kind} />
        <ModelPickerModal
            open={open}
            onClose={() => setOpen(false)}
            value={model}
            capability={kind}
            mobile={mobile}
            onChange={(value) => update(kind === "image" ? "imageModel" : "videoModel", value)}
        />
    </>;
}
