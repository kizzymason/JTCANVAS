import { useState } from "react";
import { Button, Input, Switch } from "antd";
import { ArrowRight, ChevronDown, Video } from "lucide-react";
import { PriceEstimate } from "@/components/price-estimate";
import { StudioReferences } from "@/components/workbench/studio-references";
import { StudioSettings } from "@/components/workbench/studio-settings";
import { StudioTaskBoard } from "@/components/workbench/studio-task-board";
import { useStudioComposer } from "@/hooks/use-studio-composer";
import styles from "@/components/workbench/workbench.module.css";

export default function VideoPage() {
    const studio = useStudioComposer("video");
    const [expanded, setExpanded] = useState(false);
    const [referenceMode, setReferenceMode] = useState(false);
    const hasReferences = referenceMode || studio.references.length > 0;
    return <main className={styles.studio}>
        <section className={styles.parameters} data-expanded={expanded} aria-label="视频创作设置">
            <div className={styles.parameterHeader}><h2>创作设置</h2><Video size={17} className="text-muted-foreground max-md:hidden" /><button className={styles.mobileToggle} aria-label="展开或收起创作设置" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><ChevronDown size={17} className={expanded ? "rotate-180" : ""} /></button></div>
            <div className={styles.parameterBody}>
                <div className={styles.mode}>
                    <button aria-pressed={!hasReferences} onClick={() => { setReferenceMode(false); studio.setReferences([]); }}>文生视频</button>
                    <button aria-pressed={hasReferences} onClick={() => setReferenceMode(true)}>图生视频</button>
                </div>
                {hasReferences ? <StudioReferences references={studio.references} onChange={studio.setReferences} onPrompt={studio.setPrompt} onBusy={studio.setUploading} /> : null}
                <div className={styles.field}>
                    <div className={styles.label}><label htmlFor="video-prompt">镜头描述</label><span className="flex items-center gap-2 text-[11px] font-normal text-muted-foreground">批量任务<Switch size="small" aria-label="启用视频批量任务" checked={studio.batch} onChange={studio.setBatch} /></span></div>
                    <Input.TextArea id="video-prompt" value={studio.prompt} onChange={(event) => studio.setPrompt(event.target.value)} rows={4} placeholder={studio.batch ? "每段描述生成一个独立视频，用空行分隔。\n\n例如：镜头缓缓推进，晨光穿过森林…\n\n例如：低角度跟拍，海浪涌向沙滩…" : "描述画面、动作与镜头运动…\n\n镜头缓缓向前推进，巨鲸掠过沙丘，沙尘轻轻流动，保持主体一致。"} style={{ resize: "vertical", minHeight: 100 }} />
                    {studio.batch ? <span className={styles.muted}>{studio.taskCount} 个独立任务 · 每任务 1 条视频</span> : null}
                </div>
                {!hasReferences ? <StudioReferences references={studio.references} onChange={studio.setReferences} onPrompt={studio.setPrompt} onBusy={studio.setUploading} /> : null}
                <StudioSettings kind="video" />
            </div>
            <div className={styles.footer}>
                <div className="flex items-center justify-between gap-2"><span className="text-[11px] text-muted-foreground">{studio.taskCount || 1} 个任务 · 每条 {studio.priceInput.seconds} 秒</span><PriceEstimate model={studio.model} {...studio.priceInput} /></div>
                <Button type="primary" loading={studio.submitting} disabled={!studio.taskCount || !studio.affordable || studio.uploading} onClick={() => void studio.generate()}>{!studio.affordable ? "余额不足，请充值" : studio.batch ? "批量生成视频" : "生成视频"}<ArrowRight size={16} /></Button>
            </div>
        </section>
        <StudioTaskBoard kind="video" onReuse={(task) => { studio.reuse(task); setExpanded(true); }} />
    </main>;
}

