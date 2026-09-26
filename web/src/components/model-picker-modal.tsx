import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { App, Button, Drawer, Modal } from "antd";
import { Check } from "lucide-react";

import { ModelBrandIcon } from "@/components/model-brand-icon";
import { formatMoney } from "@/lib/format-money";
import { modelCatalogApi, type ModelCatalogPublic } from "@/services/api/model-catalog";
import type { PublicModel } from "@/services/api/models";
import { useModelStore } from "@/stores/use-model-store";
import type { ModelCapability } from "@/stores/use-config-store";
import styles from "./model-picker-modal.module.css";

const UNGROUPED = "__ungrouped__";

const billingLabel: Record<string, string> = { per_image: "/ 张", per_second: "/ 秒", per_call: "/ 次", per_token: "按 token" };

let cached: ModelCatalogPublic | null = null;

/** 分组、介绍与标识来自后台维护的模型目录，这里做一次性缓存，避免每次打开弹窗都请求。 */
function useModelCatalog(open: boolean) {
    const [catalog, setCatalog] = useState<ModelCatalogPublic | null>(cached);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        if (!open || cached) return;
        let cancelled = false;
        setLoading(true);
        setError("");
        void modelCatalogApi.get()
            .then((result) => { cached = result; if (!cancelled) setCatalog(result); })
            .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "模型介绍加载失败"); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [open]);
    return { catalog, loading, error };
}

function Badge({ label, tone }: { label: string; tone?: string }) {
    return <span className={styles.badge} data-tone={tone || "primary"}>{label}</span>;
}

/**
 * 模型选择弹窗：桌面居中、移动端底部弹出。
 * 分组在顶部用滑块切换（选中项有一块会滑动的底），卡片上直接显示标识（最新/推荐…）与简介，
 * 右侧显示当前所选模型的完整介绍与计费规格。
 */
export function ModelPickerModal({ open, onClose, value, onChange, capability, mobile }: {
    open: boolean;
    onClose: () => void;
    value: string;
    onChange: (model: string) => void;
    capability: ModelCapability;
    mobile: boolean;
}) {
    const { message } = App.useApp();
    const models = useModelStore((state) => state.models);
    const loadModels = useModelStore((state) => state.load);
    const { catalog, loading, error } = useModelCatalog(open);
    const [group, setGroup] = useState<string>("all");
    const [draft, setDraft] = useState(value);
    const barRef = useRef<HTMLDivElement | null>(null);
    const [thumb, setThumb] = useState({ x: 0, width: 0, ready: false });

    useEffect(() => { void loadModels(); }, [loadModels]);
    useEffect(() => { if (open) { setDraft(value); setGroup("all"); } }, [open, value]);

    const available = useMemo(() => models.filter((model) => model.capability === capability), [models, capability]);
    const entryOf = (model: PublicModel) => catalog?.models.find((entry) => entry.modelValue === model.value);
    /** 分组顺序：后台排序优先，其后是「未分组」。空分组不显示。 */
    const sections = useMemo(() => {
        const list: Array<{ key: string; name: string; description: string; items: PublicModel[] }> = [];
        const groups = [...(catalog?.groups ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
        for (const item of groups) {
            const items = available.filter((model) => entryOf(model)?.groupId === item.id);
            if (items.length) list.push({ key: item.id, name: item.name, description: item.description, items });
        }
        const rest = available.filter((model) => { const entry = entryOf(model); return !entry || !groups.some((item) => item.id === entry.groupId); });
        if (rest.length) list.push({ key: UNGROUPED, name: groups.length ? "其他模型" : "全部模型", description: "", items: rest });
        return list;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [available, catalog]);
    const chips = useMemo(
        () => [{ key: "all", name: "全部模型", count: available.length }, ...sections.map((section) => ({ key: section.key, name: section.name, count: section.items.length }))],
        [available.length, sections],
    );
    const active = group === "all" ? null : sections.find((section) => section.key === group) ?? sections[0];
    /** 「全部模型」展示所有可用模型；选择具体分组时只看该组。 */
    const items = group === "all" ? available : active?.items ?? [];
    const current = available.find((model) => model.value === draft) ?? null;
    const currentEntry = current ? entryOf(current) : undefined;

    /** 滑块跟随选中项：位置与宽度都从 DOM 量出来，窗口缩放、数据变化后重新校准。 */
    useLayoutEffect(() => {
        const bar = barRef.current;
        if (!bar) return;
        let frame = 0;
        const sync = () => {
            const el = bar.querySelector<HTMLElement>('[data-active="true"]');
            if (!el) return;
            setThumb({ x: el.offsetLeft, width: el.offsetWidth, ready: true });
            const start = el.offsetLeft;
            const end = start + el.offsetWidth;
            if (start < bar.scrollLeft) bar.scrollTo({ left: Math.max(start - 10, 0), behavior: "smooth" });
            else if (end > bar.scrollLeft + bar.clientWidth) bar.scrollTo({ left: end - bar.clientWidth + 10, behavior: "smooth" });
        };
        frame = window.requestAnimationFrame(sync);
        const observer = new ResizeObserver(sync);
        observer.observe(bar);
        window.addEventListener("resize", sync);
        return () => { window.cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", sync); };
    }, [group, chips.length, open, mobile, items.length]);

    const body = <div className={styles.shell}>
        <div className={styles.groupBar} role="tablist" aria-label="模型分组" ref={barRef}>
            <span className={styles.groupThumb} data-ready={thumb.ready} style={{ width: thumb.width, transform: `translateX(${thumb.x}px)` }} aria-hidden="true" />
            {chips.map((chip) => (
                <button key={chip.key} type="button" role="tab" aria-selected={group === chip.key} data-active={group === chip.key} className={styles.groupChip} onClick={() => setGroup(chip.key)}>
                    <span className="truncate">{chip.name}</span><em>{chip.count}</em>
                </button>
            ))}
        </div>
        <div className={styles.body}>
            <div className={styles.list}>
                {loading ? <p className={styles.hint}>正在读取模型介绍…</p> : null}
                {error ? <p className={styles.hint}>{error}（已回退到基础列表）</p> : null}
                <div className={styles.cards}>
                    {items.map((model) => {
                        const entry = entryOf(model);
                        return <button key={model.value} type="button" className={styles.card} data-selected={model.value === draft} onClick={() => setDraft(model.value)}>
                            <span className={styles.cardHead}>
                                <ModelBrandIcon model={model.displayName} className="size-5" />
                                <span className="min-w-0 flex-1 truncate text-left text-[13px] font-medium">{model.displayName}</span>
                                {model.value === draft ? <Check size={14} className={styles.check} /> : null}
                            </span>
                            {entry?.badges?.length ? <span className={styles.badges}>{entry.badges.slice(0, 3).map((badge) => <Badge key={`${badge.key}-${badge.label}`} label={badge.label} tone={badge.tone} />)}</span> : null}
                            <span className={styles.summary}>{entry?.summary || "暂无介绍"}</span>
                            <span className={styles.price}>{billingLabel[model.billingMode] || ""} {formatMoney(model.unitPrice) === "0" ? "免费" : `¥${formatMoney(model.unitPrice)}`}</span>
                        </button>;
                    })}
                </div>
                {!items.length && !loading ? <p className={styles.hint}>当前分类下没有可用模型</p> : null}
            </div>
            <section className={styles.detail} aria-label="模型介绍">
                {current ? <>
                    <header className={styles.detailHead}>
                        <ModelBrandIcon model={current.displayName} className="size-6" />
                        <div className="min-w-0"><h4 className="truncate text-sm font-semibold">{current.displayName}</h4><p className="truncate text-[11px] text-muted-foreground">{currentEntry?.summary || current.modelName}</p></div>
                    </header>
                    {currentEntry?.badges?.length ? <div className={styles.badges}>{currentEntry.badges.map((badge) => <Badge key={`${badge.key}-${badge.label}`} label={badge.label} tone={badge.tone} />)}</div> : null}
                    <p className={styles.description}>{currentEntry?.description?.trim() || "这个模型还没有填写介绍。管理员可以在后台「模型介绍」里补充它的能力、适用场景与注意事项。"}</p>
                    <dl className={styles.specs}>
                        <div><dt>计费</dt><dd>{billingLabel[current.billingMode] || current.billingMode} ¥{formatMoney(current.unitPrice)}</dd></div>
                        {current.features?.resolutions?.length ? <div><dt>清晰度</dt><dd>{current.features.resolutions.join(" / ")}</dd></div> : null}
                        {current.features?.videoResolutions?.length ? <div><dt>分辨率</dt><dd>{current.features.videoResolutions.map((item) => item === "2160" ? "4K" : `${item}p`).join(" / ")}</dd></div> : null}
                        {current.features?.maxCount ? <div><dt>张数</dt><dd>最多 {current.features.maxCount} 张</dd></div> : null}
                        {current.features?.maxSeconds ? <div><dt>时长</dt><dd>{current.features.minSeconds ?? 1}–{current.features.maxSeconds} 秒</dd></div> : null}
                    </dl>
                </> : <p className={styles.hint}>选择一个模型即可查看介绍</p>}
            </section>
        </div>
    </div>;

    const footer = <div className={styles.footer}>
        <span className={styles.footerHint}>{current ? `将使用 ${current.displayName}` : "请选择一个模型"}</span>
        <Button disabled={!current} type="primary" onClick={() => { if (!current) return; onChange(current.value); message.success(`已切换为 ${current.displayName}`); onClose(); }}>使用该模型</Button>
    </div>;

    if (mobile) {
        return <Drawer placement="bottom" height="88dvh" open={open} onClose={onClose} title="选择模型" styles={{ body: { padding: 0, overflow: "hidden" } }} footer={footer}>
            {body}
        </Drawer>;
    }
    return <Modal open={open} onCancel={onClose} title="选择模型" width={880} footer={footer} centered styles={{ body: { padding: 0 } }}>
        {body}
    </Modal>;
}

export { cached as cachedModelCatalog };
