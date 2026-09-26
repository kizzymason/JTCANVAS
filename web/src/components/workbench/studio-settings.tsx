import { ModelPicker } from "@/components/model-picker";
import { StudioOutputRow } from "@/components/workbench/studio-output-row";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import type { StudioKind } from "@/stores/use-generation-workbench-store";
import styles from "./workbench.module.css";

/**
 * 工作台左侧的参数区：只保留「生成模型」与「输出」两个入口。
 *
 * 比例、清晰度、时长、声音等参数统一收进输出行的弹出层，避免同一件事在屏幕上出现三次
 * （比例网格 + 分辨率下拉 + 时长输入框/时长预设按钮）。
 */
export function StudioSettings({ kind }: { kind: StudioKind }) {
    const config = useEffectiveConfig();
    const update = useConfigStore((state) => state.updateConfig);
    const openConfig = useConfigStore((state) => state.openConfigDialog);
    const model = (kind === "image" ? config.imageModel : config.videoModel) || config.model;
    return <>
        <div className={styles.field}>
            <div className={styles.label}>生成模型</div>
            <ModelPicker config={config} value={model} capability={kind} fullWidth onChange={(value) => update(kind === "image" ? "imageModel" : "videoModel", value)} onMissingConfig={() => openConfig(false)} />
        </div>
        <StudioOutputRow kind={kind} />
    </>;
}
