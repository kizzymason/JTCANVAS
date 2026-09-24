import { useRef, useState } from "react";
import { App, Button, Select } from "antd";
import { Upload } from "lucide-react";
import { uploadFile } from "@/services/api/files";
import type { HomeMedia } from "@/services/api/homepage";

const brandOptions = [ ["hero", "沙漠巨鲸横幅"], ["image", "花间人像"], ["video", "水下人像"], ["canvas", "巨石拱门"], ["architecture", "建筑人物"], ["ice", "冰晶人像"], ["clouds", "云端建筑"], ["panther", "丛林黑豹"] ].map(([value, label]) => ({ value, label }));

export function MediaField({ value, onChange, video = false, allowBrand = true }: { value?: HomeMedia | null; onChange?: (value: HomeMedia | null) => void; video?: boolean; allowBrand?: boolean }) {
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const { message } = App.useApp();
    const upload = async (file?: File) => {
        if (!file) return;
        setBusy(true);
        try { const saved = await uploadFile(file); onChange?.({ source: "upload", key: saved.storageKey }); }
        catch (e) { message.error(e instanceof Error ? e.message : "上传失败"); }
        finally { setBusy(false); if (input.current) input.current.value = ""; }
    };
    const url = value ? value.source === "brand" ? `/brand/gravity/${value.key}-640.webp` : `/api/admin/homepage/media/${encodeURIComponent(value.key)}` : undefined;
    return <div className="space-y-2">
        <div className="flex flex-wrap gap-2">{allowBrand ? <Select className="min-w-44" placeholder="选择品牌素材" value={value?.source === "brand" ? value.key : undefined} options={brandOptions} onChange={(key) => onChange?.({ source: "brand", key })} /> : null}<Button loading={busy} icon={<Upload size={14} />} onClick={() => input.current?.click()}>上传{video ? "视频" : "图片"}</Button>{value ? <Button type="text" onClick={() => onChange?.(null)}>清除</Button> : null}</div>
        {url ? video ? <video src={url} controls preload="metadata" className="max-h-44 max-w-full rounded" /> : <img src={url} alt="媒体预览" className="max-h-36 max-w-full rounded object-contain" /> : null}
        <input ref={input} type="file" hidden accept={video ? "video/mp4,video/webm,video/quicktime" : "image/png,image/jpeg,image/webp,image/gif,image/avif"} onChange={(e) => void upload(e.target.files?.[0])} />
    </div>;
}
