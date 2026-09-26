import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Drawer, Dropdown, Image, Pagination, Tag } from "antd";
import { ChevronDown, ChevronLeft, ChevronRight, Download, Expand, FolderPlus, History, ImagePlus, Images, LoaderCircle, RefreshCw, SlidersHorizontal, Trash2, Video, X } from "lucide-react";
import { saveAs } from "file-saver";
import { fetchTasks, isTerminal, type GenerationTask, type TaskOutput } from "@/services/api/generation";
import { fileUrl } from "@/services/api/files";
import { useAssetStore } from "@/stores/use-asset-store";
import { useGenerationWorkbenchStore, type StudioKind, type StudioTask } from "@/stores/use-generation-workbench-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { modelOptionLabel } from "@/stores/use-config-store";
import styles from "./workbench.module.css";

const statusLabel: Record<string, string> = { pending: "排队中", running: "生成中", succeeded: "已完成", partial: "部分完成", failed: "生成失败", cancelled: "已取消" };
const active = (entry: StudioTask) => entry.task ? !isTerminal(entry.task.status) : !entry.error;
const title = (entry: StudioTask) => entry.task?.prompt ?? entry.input?.prompt ?? "生成任务";
const meta = (task: GenerationTask) => [modelOptionLabel(task.model || task.modelName), task.params.size === "auto" ? "自动比例" : task.params.size, task.capability === "image" ? task.params.quality === "auto" ? "自动质量" : task.params.quality : `${task.params.resolution}p`, task.capability === "video" ? `${task.params.seconds} 秒` : `${task.params.count ?? 1} 张`].filter(Boolean).join(" · ");

export function StudioTaskBoard({ kind, onReuse, onReference }: { kind: StudioKind; onReuse: (task: GenerationTask) => void; onReference?: (output: TaskOutput) => void }) {
    const entries = useGenerationWorkbenchStore((state) => state.entries);
    const userId = useAuthStore((state) => state.user?.id);
    const { message, modal } = App.useApp();
    const [filter, setFilter] = useState("all");
    const [page, setPage] = useState(1);
    const capacity = 1;
    const [historyOpen, setHistoryOpen] = useState(false);
    const [detailId, setDetailId] = useState<string>();
    const [historyPage, setHistoryPage] = useState(1);
    const [historyIds, setHistoryIds] = useState<string[]>([]);
    const [historyTotal, setHistoryTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [reload, setReload] = useState(0);
    const tasks = useMemo(() => Object.values(entries).filter((entry) => (entry.task?.capability ?? entry.input?.capability) === kind).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)), [entries, kind]);
    const filtered = tasks.filter((entry) => filter === "all" || (filter === "active" ? active(entry) : filter === "done" ? entry.task?.status === "succeeded" || entry.task?.status === "partial" : Boolean(entry.error) || entry.task?.status === "failed" || entry.task?.status === "cancelled"));
    const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / capacity)));
    const visible = filtered.slice((currentPage - 1) * capacity, currentPage * capacity);
    const pageCount = Math.max(1, Math.ceil(filtered.length / capacity));
    const detail = detailId ? entries[detailId] : undefined;

    useEffect(() => {
        let cancelled = false;
        const owner = useAuthStore.getState().user;
        setLoading(true);
        setError("");
        const load = async () => {
            const result = await fetchTasks({ page: historyPage, pageSize: 20, capability: kind });
            if (cancelled || useAuthStore.getState().user?.id !== owner?.id) return;
            useGenerationWorkbenchStore.getState().ingest(result.items);
            setHistoryIds(result.items.map((task) => task.id));
            setHistoryTotal(result.total);
        };
        void load().catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "生成记录加载失败"); }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [kind, historyPage, reload, userId]);

    useEffect(() => {
        let cancelled = false;
        void useGenerationWorkbenchStore.getState().recover(kind).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "运行任务恢复失败"); });
        return () => { cancelled = true; };
    }, [kind, userId, reload]);

    const removeHistoryTask = (task: GenerationTask) => {
        if (!isTerminal(task.status)) return;
        modal.confirm({
            title: "删除任务记录",
            content: "删除后不可恢复；已经保存到资产的内容不受影响。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await useGenerationWorkbenchStore.getState().removeTask(task.id);
                    setHistoryIds((ids) => ids.filter((id) => id !== task.id));
                    setHistoryTotal((total) => Math.max(0, total - 1));
                    if (detailId === task.id) setDetailId(undefined);
                    message.success("任务记录已删除");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "删除失败，请重试");
                    throw error;
                }
            },
        });
    };

    return <section className={styles.board} aria-label="生成结果工作区">
        <div className={styles.boardHeader}>
            <div className={styles.filters} role="tablist" aria-label="任务状态筛选">
                {[["active", "进行中"], ["done", "已完成"], ["failed", "需关注"], ["all", "全部"]].map(([value, label]) => <button key={value} role="tab" aria-selected={filter === value} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1); }}>{label}</button>)}
            </div>
            <div className={styles.boardTools}>
                <button className={styles.refreshButton} aria-label="刷新任务" title="刷新任务" onClick={() => setReload((value) => value + 1)}><RefreshCw size={14} /></button>
                <Button size="small" icon={<History size={14} />} onClick={() => { setHistoryOpen(true); setReload((value) => value + 1); }}>任务记录</Button>
            </div>
        </div>
        {error ? <div role="alert" className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{error}</span><Button size="small" onClick={() => setReload((value) => value + 1)}>重新同步</Button></div> : null}
        {visible.length ? <div className={styles.grid} data-count={visible.length}>
            {visible.map((entry) => <TaskCard key={entry.id} entry={entry} kind={kind} page={currentPage} pageCount={pageCount}
                onPrev={() => setPage(currentPage - 1)} onNext={() => setPage(currentPage + 1)}
                onOpen={() => setDetailId(entry.id)} onReuse={onReuse} onReference={onReference} />)}
        </div> : <div className={styles.empty}>
            <div className={styles.emptyIcon}>{loading ? <LoaderCircle className={styles.spinner} size={29} /> : kind === "image" ? <Images size={29} /> : <Video size={29} />}</div>
            <h3>{loading ? "正在加载任务" : "暂无任务"}</h3>
        </div>}
        <Drawer title="任务记录" open={historyOpen} onClose={() => setHistoryOpen(false)} size={420} styles={{ wrapper: { maxWidth: "100vw" }, body: { padding: "0 20px 20px" } }}>
            {loading ? <p role="status" className="py-6 text-sm">正在读取记录…</p> : error ? <Button onClick={() => setReload((value) => value + 1)}>加载失败，点击重试</Button> : historyIds.length ? historyIds.map((id) => {
                const entry = entries[id];
                if (!entry?.task) return null;
                const output = entry.task.outputs[0];
                return <div key={id} className={styles.historyItem}>
                    <button className={styles.historyMain} onClick={() => setDetailId(id)}>
                        <span className={styles.historyThumb}>{output && kind === "image" ? <img src={fileUrl(output.storageKey, "thumb")} alt={entry.task.prompt} loading="lazy" /> : kind === "video" ? <Video size={23} /> : <Images size={23} />}</span>
                        <span className="min-w-0 flex-1"><span className="mb-1 block truncate text-sm">{entry.task.prompt}</span><span className="block truncate text-[11px] text-muted-foreground">{meta(entry.task)}</span><span className="mt-2 block text-[10px] text-muted-foreground">{new Date(entry.createdAt).toLocaleString()} · {statusLabel[entry.task.status]}</span></span>
                    </button>
                    <Button danger type="text" size="small" aria-label="删除任务记录" title={isTerminal(entry.task.status) ? "删除任务记录" : "进行中的任务不能删除"} disabled={!isTerminal(entry.task.status)} icon={<Trash2 size={15} />} onClick={() => removeHistoryTask(entry.task!)} />
                </div>;
            }) : <p className="py-6 text-sm text-muted-foreground">还没有生成记录</p>}
            <Pagination className="mt-5" size="small" current={historyPage} pageSize={20} total={historyTotal} showSizeChanger={false} onChange={setHistoryPage} />
        </Drawer>
        <Drawer title="任务详情" placement="right" open={Boolean(detail)} onClose={() => setDetailId(undefined)} width={720} destroyOnClose styles={{ body: { padding: "0 24px 24px", overflowY: "auto" } }}>
            {detail?.task ? <TaskDetail key={detail.id} task={detail.task} onReuse={(task) => { onReuse(task); setDetailId(undefined); }} onReference={onReference} /> : detail ? <div className="py-5"><p>{title(detail)}</p><p className="mt-3 text-sm text-muted-foreground">{detail.error || "正在提交…"}</p></div> : null}
        </Drawer>
    </section>;
}

/** 卡片只保留画面本身，操作按钮和上一组 / 下一组切换都压在底部右侧。 */
function TaskCard({ entry, kind, page, pageCount, onPrev, onNext, onOpen, onReuse, onReference }: {
    entry: StudioTask; kind: StudioKind; page: number; pageCount: number; onPrev: () => void; onNext: () => void;
    onOpen: () => void; onReuse: (task: GenerationTask) => void; onReference?: (output: TaskOutput) => void;
}) {
    const output = entry.task?.outputs[0];
    const running = active(entry);
    const status = entry.task ? statusLabel[entry.task.status] : entry.error ? entry.uncertain ? "提交待确认" : "提交未成功" : "正在提交";
    const failure = entry.error || entry.task?.error;
    const actions = useOutputActions(entry.task, output, onReference);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const runSetting = (action: () => void) => { setSettingsOpen(false); action(); };
    const settingsItems = [
        { key: "save", icon: <FolderPlus size={14} />, label: "存到资产", onClick: () => runSetting(() => void actions.save()) },
        { key: "reference", icon: <ImagePlus size={14} />, label: "作参考", onClick: () => runSetting(actions.addReference) },
        { key: "reuse", icon: <RefreshCw size={14} />, label: "复用参数", onClick: () => runSetting(() => onReuse(entry.task!)) },
    ].filter((item) => item.key !== "reference" || (Boolean(onReference) && kind === "image"));
    return <article className={styles.task} data-active={running}>
        <div className={styles.media}>
            {output ? kind === "image" ? <div className={styles.mediaFill}>
                <Image src={fileUrl(output.storageKey)} alt={title(entry)} style={{ width: "100%", height: "100%" }} styles={{ image: { width: "100%", height: "100%", objectFit: "contain" } }} preview={{ mask: null }} />
            </div> : <video key={output.id} src={fileUrl(output.storageKey)} controls preload="metadata" playsInline /> : <div className={styles.pending}>
                {running ? <LoaderCircle size={26} className={styles.spinner} /> : <X size={25} />}
                <strong>{status}</strong>
                <p title={failure}>{failure}</p>
                {running ? <Elapsed createdAt={entry.createdAt} /> : null}
                {entry.error ? <Button size="small" onClick={() => entry.task ? useGenerationWorkbenchStore.getState().resume(entry.id) : void useGenerationWorkbenchStore.getState().retrySubmission(entry.id)}>{entry.task ? "恢复状态同步" : entry.uncertain ? "确认原提交" : "重试提交"}</Button> : entry.task && !running ? <Button size="small" onClick={() => onReuse(entry.task!)}>编辑后重试</Button> : null}
            </div>}
        </div>
        <div className={styles.taskBar}>
            {output && entry.task ? <>
                <Button icon={<Download size={14} />} loading={actions.downloading} onClick={() => void actions.download()}>下载</Button>
                <Button icon={<Expand size={14} />} onClick={onOpen}>详情</Button>
                <Dropdown open={settingsOpen} onOpenChange={setSettingsOpen} trigger={["click"]} placement="topLeft" menu={{ items: settingsItems }}>
                    <Button icon={<SlidersHorizontal size={14} />} loading={actions.saving}>设置<ChevronDown size={13} /></Button>
                </Dropdown>
            </> : null}
            {pageCount > 1 ? <div className={styles.taskPager}>
                <Button disabled={page <= 1} icon={<ChevronLeft size={15} />} onClick={onPrev}>上一组</Button>
                <span className="tabular-nums">{page} / {pageCount}</span>
                <Button disabled={page >= pageCount} iconPosition="end" icon={<ChevronRight size={15} />} onClick={onNext}>下一组</Button>
            </div> : null}
        </div>
    </article>;
}

function Elapsed({ createdAt }: { createdAt: string }) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
    const seconds = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1000));
    return <span className="text-[11px] tabular-nums">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>;
}

/** 输出结果的下载、存资产与作参考动作，卡片底部按钮和详情抽屉共用同一份实现。 */
function useOutputActions(task?: GenerationTask, output?: TaskOutput, onReference?: (output: TaskOutput) => void) {
    const { message } = App.useApp();
    const [saving, setSaving] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const saveLock = useRef(false);
    const save = async () => {
        if (!task || !output || saveLock.current) return;
        saveLock.current = true;
        setSaving(true);
        try {
            const image = task.capability === "image";
            await useAssetStore.getState().addAsset({
                kind: image ? "image" : "video", title: task.prompt.slice(0, 30), coverUrl: image ? fileUrl(output.storageKey, "thumb") : "", tags: [], source: image ? "图片工作台" : "视频工作台",
                data: { ...(image ? { dataUrl: fileUrl(output.storageKey) } : { url: fileUrl(output.storageKey) }), storageKey: output.storageKey, width: output.width ?? 0, height: output.height ?? 0, bytes: output.bytes, mimeType: output.mimeType, durationMs: output.durationMs ?? 0 },
                metadata: { source: `${task.capability}-page`, prompt: task.prompt, taskId: task.id },
            });
            message.success("已保存到我的资产");
        } catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); }
        finally { saveLock.current = false; setSaving(false); }
    };
    const download = async () => {
        if (!task || !output) return;
        setDownloading(true);
        try {
            const response = await fetch(fileUrl(output.storageKey), { credentials: "include" });
            if (!response.ok) throw new Error("下载失败，请重试");
            const extension = output.mimeType.split("/")[1]?.replace("jpeg", "jpg") || (task.capability === "image" ? "png" : "mp4");
            saveAs(await response.blob(), `${task.capability}-${output.id}.${extension}`);
        } catch (error) { message.error(error instanceof Error ? error.message : "下载失败"); }
        finally { setDownloading(false); }
    };
    const addReference = () => { if (!output) return; onReference?.(output); message.success("已添加为参考图"); };
    return { saving, downloading, save, download, addReference };
}

function OutputActions({ task, output, onReference }: { task: GenerationTask; output: TaskOutput; onReference?: (output: TaskOutput) => void }) {
    const actions = useOutputActions(task, output, onReference);
    return <><Button type="text" size="small" loading={actions.downloading} icon={<Download size={12} />} onClick={() => void actions.download()}>下载</Button><Button type="text" size="small" loading={actions.saving} icon={<FolderPlus size={12} />} onClick={() => void actions.save()}>存到资产</Button>{onReference && task.capability === "image" ? <Button type="text" size="small" icon={<ImagePlus size={12} />} onClick={actions.addReference}>作参考</Button> : null}</>;
}

function TaskDetail({ task, onReuse, onReference }: { task: GenerationTask; onReuse: (task: GenerationTask) => void; onReference?: (output: TaskOutput) => void }) {
    return <div className="space-y-3 py-3">
        {task.outputs.length ? <div className={task.capability === "image" ? styles.detailImageGrid : styles.detailVideoList}>
            {task.outputs.map((output, index) => <div key={output.id} className={styles.detailOutput}>
                <div className={styles.detailMedia}>{task.capability === "image" ? <Image src={fileUrl(output.storageKey)} alt={`${task.prompt} ${index + 1}`} styles={{ root: { width: "100%", height: "100%", display: "flex", justifyContent: "center" }, image: { width: "100%", height: "100%", objectFit: "contain" } }} /> : <video src={fileUrl(output.storageKey)} controls playsInline preload="metadata" />}</div>
                <div className="flex flex-wrap items-center gap-2 px-1 pt-2"><OutputActions task={task} output={output} onReference={onReference} /><span className="ml-auto text-xs text-muted-foreground">{output.width} × {output.height}</span></div>
            </div>)}
        </div> : <p className="py-8 text-center text-muted-foreground">{statusLabel[task.status]}</p>}
        <div className="border-t border-border pt-4"><div className="flex items-center justify-between gap-2"><Tag>{statusLabel[task.status]}</Tag><Button size="small" icon={<RefreshCw size={13} />} onClick={() => onReuse(task)}>复用参数</Button></div><p className="mt-3 whitespace-pre-wrap break-words text-sm">{task.prompt}</p><p className="mt-2 text-xs text-muted-foreground">{meta(task)}</p>{task.error ? <p className="mt-2 text-xs" role="alert">{task.error}</p> : null}</div>
    </div>;
}
