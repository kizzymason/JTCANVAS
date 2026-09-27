import { Button } from "antd";
import { ArrowRight } from "lucide-react";
import { nanoid } from "nanoid";
import { StudioComposer } from "@/components/workbench/studio-composer";
import { StudioSettings } from "@/components/workbench/studio-settings";
import { StudioTaskBoard } from "@/components/workbench/studio-task-board";
import { useStudioComposer } from "@/hooks/use-studio-composer";
import { fileUrl } from "@/services/api/files";
import styles from "@/components/workbench/workbench.module.css";

export default function ImagePage() {
    const studio = useStudioComposer("image");
    return <main className={styles.studio}>
        <section className={styles.parameters} aria-label="图片创作设置">
            <div className={styles.parameterBody}>
                <StudioComposer id="image-prompt" label="提示词" placeholder="描述主体、场景、光线与风格…" value={studio.prompt} onChange={studio.setPrompt}
                    references={studio.references} onReferences={studio.setReferences} onBusy={studio.setUploading} />
                <StudioSettings kind="image" />
            </div>
            <div className={styles.footer}>
                <Button type="primary" className="!h-11 !w-full" loading={studio.submitting} disabled={!studio.taskCount || !studio.affordable || studio.uploading} onClick={() => void studio.generate()}>
                    {!studio.affordable ? "余额不足，请充值" : "生成图片"}
                    {studio.affordable && studio.amount ? <span className="text-[12px] opacity-80">¥{studio.amount}</span> : null}
                    <ArrowRight size={16} />
                </Button>
            </div>
        </section>
        <StudioTaskBoard kind="image" onReuse={(task) => { studio.reuse(task); }} onReference={(output) => { studio.setReferences((current) => [...current, { id: nanoid(), name: "生成图片", type: output.mimeType, dataUrl: fileUrl(output.storageKey), storageKey: output.storageKey }]); }} />
    </main>;
}
