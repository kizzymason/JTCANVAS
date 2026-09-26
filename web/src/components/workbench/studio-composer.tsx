import { App, Dropdown, Input } from "antd";
import { ChevronDown, FolderOpen, ImagePlus, LoaderCircle, Upload, X } from "lucide-react";
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { nanoid } from "nanoid";
import { AssetPickerModal } from "@/components/canvas/asset-picker-modal";
import { uploadImage } from "@/services/image-storage";
import { fileNameFromImageUrl, publicImageUrlsFromText } from "@/services/api/reference-upload";
import type { ReferenceImage } from "@/types/image";
import styles from "./workbench.module.css";

/**
 * 描述与参考图合一的输入框：像聊天输入框那样，参考图直接贴在框内，左下角按钮用于上传或从资产选择。
 * 整块输入框都接受拖入与粘贴；有参考图即为图生，没有就是文生，不再需要模式切换。
 */
export function StudioComposer({ id, label, placeholder, value, onChange, references, onReferences, onBusy }: {
    id: string;
    label: string;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
    references: ReferenceImage[];
    onReferences: Dispatch<SetStateAction<ReferenceImage[]>>;
    onBusy: (busy: boolean) => void;
}) {
    const { message } = App.useApp();
    const input = useRef<HTMLInputElement>(null);
    const [picker, setPicker] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const busy = useRef(false);
    const startResize = (event: React.PointerEvent<HTMLElement>) => {
        const area = box.current?.querySelector("textarea");
        if (!area) return;
        drag.current = { y: event.clientY, height: area.offsetHeight };
        pending.current = null;
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const moveResize = (event: React.PointerEvent<HTMLElement>) => {
        const area = box.current?.querySelector("textarea");
        if (!drag.current || !area) return;
        const next = Math.max(140, Math.min(640, drag.current.height + event.clientY - drag.current.y));
        area.style.height = `${next}px`;
        pending.current = next;
    };
    const endResize = () => {
        if (pending.current !== null) { setHeight(pending.current); pending.current = null; }
        drag.current = null;
    };
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
            onReferences((current) => [...current, ...results.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])]);
            if (results.some((result) => result.status === "rejected")) message.error("部分参考图上传失败，请重新上传失败的图片");
        } finally { busy.current = false; setUploading(false); onBusy(false); }
    };
    const move = (index: number, offset: number) => onReferences((current) => {
        const next = [...current];
        if (index + offset < 0 || index + offset >= next.length) return current;
        [next[index], next[index + offset]] = [next[index + offset], next[index]];
        return next;
    });
    return <div className={styles.field}>
        <div className={styles.label}><label htmlFor={id}>{label}</label></div>
        <div className={styles.composer} tabIndex={0} aria-label={`${label}与参考图片，支持拖放和粘贴`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); void upload(Array.from(event.dataTransfer.files)); }}
            onPaste={(event) => {
                const files = Array.from(event.clipboardData.files);
                if (files.length) { event.preventDefault(); void upload(files); return; }
                const urls = publicImageUrlsFromText(event.clipboardData.getData("text"));
                if (urls.length) { event.preventDefault(); onReferences((current) => [...current, ...urls.map((url) => ({ id: nanoid(), name: fileNameFromImageUrl(url), type: "image/png", dataUrl: url }))]); }
            }}>
            {references.length ? <div className={styles.composerRefs}>{references.map((item, index) => <div className={styles.composerRef} key={item.id}>
                <img src={item.dataUrl} alt={item.name} />
                <span>{index + 1}</span>
                <button type="button" className={styles.composerRemove} aria-label={`移除参考图 ${index + 1}`} onClick={() => onReferences((current) => current.filter((ref) => ref.id !== item.id))}><X size={11} /></button>
                {references.length > 1 ? <div className={styles.composerOrder}>
                    <button type="button" aria-label={`参考图 ${index + 1} 前移`} disabled={index === 0} onClick={() => move(index, -1)}>‹</button>
                    <button type="button" aria-label={`参考图 ${index + 1} 后移`} disabled={index === references.length - 1} onClick={() => move(index, 1)}>›</button>
                </div> : null}
            </div>)}</div> : null}
            <Input.TextArea id={id} variant="borderless" value={value} onChange={(event) => onChange(event.target.value)} rows={7} placeholder={placeholder}
                style={{ resize: "none", minHeight: 140, padding: 0 }} />
            <div className={styles.composerBar}>
                <Dropdown open={menuOpen} onOpenChange={setMenuOpen} trigger={["click"]} placement="topLeft" menu={{ items: [
                    { key: "upload", icon: <Upload size={14} />, label: "上传图片", onClick: () => { setMenuOpen(false); input.current?.click(); } },
                    { key: "asset", icon: <FolderOpen size={14} />, label: "从资产选择", onClick: () => { setMenuOpen(false); setPicker(true); } },
                ] }}>
                    <button type="button" className={styles.composerAdd}>{uploading ? <LoaderCircle size={14} className={styles.spinner} /> : <ImagePlus size={14} />}添加<ChevronDown size={12} /></button>
                </Dropdown>
            </div>
        </div>
        <input ref={input} type="file" multiple accept="image/*" hidden onChange={(event) => { void upload(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
        <AssetPickerModal open={picker} onClose={() => setPicker(false)} onInsert={(payload) => {
            if (payload.kind === "text") onChange(payload.content);
            else if (payload.kind === "image") onReferences((current) => [...current, { id: nanoid(), name: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey, type: "image/png" }]);
            else { message.info("请选择图片或提示词资产"); return; }
            setPicker(false);
        }} />
    </div>;
}
