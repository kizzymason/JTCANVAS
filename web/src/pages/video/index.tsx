import { Button } from "antd";
import { ArrowRight } from "lucide-react";
import { StudioComposer } from "@/components/workbench/studio-composer";
import { StudioSettings } from "@/components/workbench/studio-settings";
import { StudioTaskBoard } from "@/components/workbench/studio-task-board";
import { useStudioComposer } from "@/hooks/use-studio-composer";
import styles from "@/components/workbench/workbench.module.css";

export default function VideoPage() {
    const studio = useStudioComposer("video");
    return <main className={styles.studio}>
        <section className={styles.parameters} aria-label="视频创作设置">
            <div className={styles.parameterBody}>
                <StudioComposer id="video-prompt" label="提示词" placeholder="描述画面、动作与镜头运动…" value={studio.prompt} onChange={studio.setPrompt}
                    references={studio.references} onReferences={studio.setReferences} onBusy={studio.setUploading} />
                <StudioSettings kind="video" />
            </div>
            <div className={styles.footer}>
                <Button type="primary" className="!h-11 !w-full" loading={studio.submitting} disabled={!studio.taskCount || !studio.affordable || studio.uploading} onClick={() => void studio.generate()}>
                    {!studio.affordable ? "余额不足，请充值" : "生成视频"}
                    {studio.affordable && studio.amount ? <span className="text-[12px] opacity-80">¥{studio.amount}</span> : null}
                    <ArrowRight size={16} />
                </Button>
            </div>
        </section>
        <StudioTaskBoard kind="video" onReuse={(task) => { studio.reuse(task); }} />
    </main>;
}
