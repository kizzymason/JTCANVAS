import { useState } from "react";
import { Button, Input, Switch } from "antd";
import { ArrowRight, ChevronDown, ImagePlus } from "lucide-react";
import { nanoid } from "nanoid";
import { PriceEstimate } from "@/components/price-estimate";
import { StudioReferences } from "@/components/workbench/studio-references";
import { StudioSettings } from "@/components/workbench/studio-settings";
import { StudioTaskBoard } from "@/components/workbench/studio-task-board";
import { useStudioComposer } from "@/hooks/use-studio-composer";
import { fileUrl } from "@/services/api/files";
import styles from "@/components/workbench/workbench.module.css";

export default function ImagePage() {
    const studio = useStudioComposer("image");
    const [expanded, setExpanded] = useState(false);
    const [referenceMode, setReferenceMode] = useState(false);
    const hasReferences = referenceMode || studio.references.length > 0;
    return <main className={styles.studio}>
        <section className={styles.parameters} data-expanded={expanded} aria-label="图片创作设置">
            <div className={styles.parameterHeader}><h2>创作设置</h2><ImagePlus size={17} className="text-muted-foreground max-md:hidden" /><button className={styles.mobileToggle} aria-label="展开或收起创作设置" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><ChevronDown size={17} className={expanded ? "rotate-180" : ""} /></button></div>
            <div className={styles.parameterBody}>
                <div className={styles.mode}>
                    <button aria-pressed={!hasReferences} onClick={() => { setReferenceMode(false); studio.setReferences([]); }}>文生图</button>
                    <button aria-pressed={hasReferences} onClick={() => setReferenceMode(true)}>图生图</button>
                </div>
                <div className={styles.field}>
                    <div className={styles.label}><label htmlFor="image-prompt">画面描述</label><span className="flex items-center gap-2 text-[11px] font-normal text-muted-foreground">批量任务<Switch size="small" aria-label="启用图片批量任务" checked={studio.batch} onChange={studio.setBatch} /></span></div>
                    <Input.TextArea id="image-prompt" value={studio.prompt} onChange={(event) => studio.setPrompt(event.target.value)} rows={4} placeholder={studio.batch ? "每段描述生成一个独立任务，用空行分隔。\n\n例如：雨后街道，倒映霓虹的水面…\n\n例如：清晨山谷，薄雾中的木屋…" : "描述主体、场景、光线与风格…\n\n银色巨鲸游弋于沙漠上空，远处行者仰望，月光与沙尘交织，电影质感。"} style={{ resize: "vertical", minHeight: 100 }} />
                    {studio.batch ? <span className={styles.muted}>{studio.taskCount} 个独立任务 · 空行分隔提示词</span> : null}
                </div>
                <StudioReferences references={studio.references} onChange={studio.setReferences} onPrompt={studio.setPrompt} onBusy={studio.setUploading} />
                <StudioSettings kind="image" />
            </div>
            <div className={styles.footer}>
                <div className="flex items-center justify-between gap-2"><span className="text-[11px] text-muted-foreground">{studio.taskCount || 1} 个任务 · 每任务 {studio.priceInput.count} 张</span><PriceEstimate model={studio.model} {...studio.priceInput} /></div>
                <Button type="primary" loading={studio.submitting} disabled={!studio.taskCount || !studio.affordable || studio.uploading} onClick={() => void studio.generate()}>{!studio.affordable ? "余额不足，请充值" : studio.batch ? "批量生成图片" : "生成图片"}<ArrowRight size={16} /></Button>
            </div>
        </section>
        <StudioTaskBoard kind="image" onReuse={(task) => { studio.reuse(task); setExpanded(true); }} onReference={(output) => { studio.setReferences((current) => [...current, { id: nanoid(), name: "生成图片", type: output.mimeType, dataUrl: fileUrl(output.storageKey), storageKey: output.storageKey }]); setReferenceMode(true); setExpanded(true); }} />
    </main>;
}

