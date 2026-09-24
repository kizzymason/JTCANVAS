import { App, Button } from "antd";
import { ArrowLeft, ArrowRight, ClipboardPaste, FolderOpen, Upload, X } from "lucide-react";
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { nanoid } from "nanoid";
import { AssetPickerModal } from "@/components/canvas/asset-picker-modal";
import { uploadImage } from "@/services/image-storage";
import { fileNameFromImageUrl, publicImageUrlsFromText } from "@/services/api/reference-upload";
import type { ReferenceImage } from "@/types/image";
import styles from "./workbench.module.css";

export function StudioReferences({ references, onChange, onPrompt, onBusy }: {
    references: ReferenceImage[];
    onChange: Dispatch<SetStateAction<ReferenceImage[]>>;
    onPrompt: (value: string) => void;
    onBusy: (busy: boolean) => void;
}) {
    const { message } = App.useApp();
    const input = useRef<HTMLInputElement>(null);
    const [picker, setPicker] = useState(false);
    const [uploading, setUploading] = useState(false);
    const busy = useRef(false);
    const upload = async (files: Blob[]) => {
        if (busy.current || !files.length) return;
        busy.current = true;
        setUploading(true);
        onBusy(true);
        try {
            const results = await Promise.allSettled(files.filter((file) => file.type.startsWith("image/")).map(async (file) => {
                const stored = await uploadImage(file);
                return { id: nanoid(), name: file instanceof File ? file.name : "粘贴图片", type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey };
            }));
            onChange((current) => [...current, ...results.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])]);
            if (results.some((result) => result.status === "rejected")) message.error("部分参考图上传失败，请重新上传失败的图片");
        } finally { busy.current = false; setUploading(false); onBusy(false); }
    };
    const paste = async () => {
        try {
            const items = await navigator.clipboard.read();
            const files = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (files.length) { await upload(files); return; }
            const urls = publicImageUrlsFromText(await navigator.clipboard.readText());
            if (!urls.length) throw new Error("剪贴板中没有图片或图片链接");
            onChange((current) => [...current, ...urls.map((url) => ({ id: nanoid(), name: fileNameFromImageUrl(url), type: "image/png", dataUrl: url }))]);
        } catch (error) { message.error(error instanceof Error ? error.message : "无法读取剪贴板，请直接粘贴或上传图片"); }
    };
    const move = (index: number, offset: number) => onChange((current) => {
        const next = [...current];
        if (index + offset < 0 || index + offset >= next.length) return current;
        [next[index], next[index + offset]] = [next[index + offset], next[index]];
        return next;
    });
    return <div className={styles.field} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(Array.from(event.dataTransfer.files)); }}
        onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length) { event.preventDefault(); void upload(files); return; }
            const urls = publicImageUrlsFromText(event.clipboardData.getData("text"));
            if (urls.length) { event.preventDefault(); onChange((current) => [...current, ...urls.map((url) => ({ id: nanoid(), name: fileNameFromImageUrl(url), type: "image/png", dataUrl: url }))]); }
        }} tabIndex={0} aria-label="参考图片，支持拖放和粘贴">
        <div className={styles.label}>参考图片 <span className={styles.muted}>{references.length ? `${references.length} 张 · 按序引用` : "可选"}</span></div>
        {references.length ? <div className={styles.referenceGrid}>{references.map((item, index) => <div className={styles.reference} key={item.id}>
            <img src={item.dataUrl} alt={item.name} /><span>图 {index + 1}</span>
            <button aria-label={`移除参考图 ${index + 1}`} onClick={() => onChange((current) => current.filter((ref) => ref.id !== item.id))}><X size={12} /></button>
            {references.length > 1 ? <div className={styles.referenceOrder}><button aria-label="前移参考图" disabled={index === 0} onClick={() => move(index, -1)}><ArrowLeft size={11} /></button><button aria-label="后移参考图" disabled={index === references.length - 1} onClick={() => move(index, 1)}><ArrowRight size={11} /></button></div> : null}
        </div>)}</div> : <div className={styles.dropzone}>拖入或粘贴图片，为灵感提供参考</div>}
        <div className="flex flex-wrap gap-1.5">
            <Button size="small" icon={<Upload size={13} />} loading={uploading} onClick={() => input.current?.click()}>上传图片</Button>
            <Button size="small" icon={<FolderOpen size={13} />} onClick={() => setPicker(true)}>从资产选择</Button>
            <Button size="small" aria-label="从剪贴板粘贴" title="从剪贴板粘贴" icon={<ClipboardPaste size={13} />} onClick={() => void paste()} />
        </div>
        <input ref={input} type="file" multiple accept="image/*" hidden onChange={(event) => { void upload(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
        <AssetPickerModal open={picker} onClose={() => setPicker(false)} onInsert={(payload) => {
            if (payload.kind === "text") onPrompt(payload.content);
            else if (payload.kind === "image") onChange((current) => [...current, { id: nanoid(), name: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey, type: "image/png" }]);
            else { message.info("请选择图片或提示词资产"); return; }
            setPicker(false);
        }} />
    </div>;
}
