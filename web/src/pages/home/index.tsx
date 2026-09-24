import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Empty, Modal, Skeleton } from "antd";
import { ArrowDown, ArrowRight, Play, Search } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { homepageApi, type PublicHome, type PublicMedia, type PublicWork } from "@/services/api/homepage";
import { requireAuth } from "@/stores/use-auth-modal-store";
import { useSiteServices } from "@/hooks/use-site-services";
import styles from "./home.module.css";

function responsive(media: PublicMedia) {
    return media.url.startsWith("/brand/") ? `${media.thumbUrl} 640w, ${media.mediumUrl} 1280w, ${media.url} 2560w` : `${media.thumbUrl} 320w, ${media.mediumUrl} 1024w`;
}

let homepageConfigCache: PublicHome["config"] | undefined;
let homepageConfigRequest: Promise<PublicHome["config"]> | null = null;
let homepageWorksCache: PublicWork[] | null = null;
let homepageWorksRequest: Promise<PublicWork[]> | null = null;

async function preloadHomepageAssets(config: PublicHome["config"]) {
    const images = [
        ...(config?.hero?.media ? [{ media: config.hero.media, sizes: "(max-width:639px) 1200px, (min-width:1200px) calc(100vw - 216px), 100vw" }] : []),
        ...(config?.entries || []).flatMap((entry) => entry.media ? [{ media: entry.media, sizes: "(max-width:767px) 90vw, 30vw" }] : []),
    ];
    await Promise.all(images.map(({ media, sizes }) => new Promise<void>((resolve) => {
        const image = new window.Image();
        image.decoding = "async";
        image.sizes = sizes;
        image.srcset = responsive(media);
        image.src = media.mediumUrl;
        const decoded = image.decode?.();
        if (decoded) void decoded.then(() => resolve(), () => resolve());
        else {
            image.onload = () => resolve();
            image.onerror = () => resolve();
        }
    })));
}

function getHomepageConfig() {
    if (homepageConfigCache !== undefined) return Promise.resolve(homepageConfigCache);
    if (!homepageConfigRequest) {
        homepageConfigRequest = homepageApi.getConfig()
            .then(async ({ config }) => {
                await preloadHomepageAssets(config);
                homepageConfigCache = config;
                return config;
            })
            .catch((error: unknown) => {
                homepageConfigRequest = null;
                throw error;
            });
    }
    return homepageConfigRequest;
}

function getHomepageWorks() {
    if (homepageWorksCache) return Promise.resolve(homepageWorksCache);
    if (!homepageWorksRequest) {
        homepageWorksRequest = homepageApi.getWorks()
            .then(({ works }) => {
                homepageWorksCache = works;
                return works;
            })
            .catch((error: unknown) => {
                homepageWorksRequest = null;
                throw error;
            });
    }
    return homepageWorksRequest;
}

export default function HomePage() {
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const [config, setConfig] = useState<PublicHome["config"] | undefined>(homepageConfigCache);
    const [worksData, setWorksData] = useState<PublicWork[] | null>(homepageWorksCache);
    const [configError, setConfigError] = useState(false);
    const [worksError, setWorksError] = useState(false);
    const [configAttempt, setConfigAttempt] = useState(0);
    const [worksAttempt, setWorksAttempt] = useState(0);
    const [category, setCategory] = useState("全部");
    const [preview, setPreview] = useState<PublicWork | null>(null);
    const services = useSiteServices();
    const query = params.get("q") || "";
    useEffect(() => {
        let active = true;
        setConfigError(false);
        getHomepageConfig()
            .then((value) => { if (active) setConfig(value); })
            .catch(() => { if (active) setConfigError(true); });
        return () => { active = false; };
    }, [configAttempt]);
    useEffect(() => {
        let active = true;
        setWorksError(false);
        getHomepageWorks()
            .then((value) => { if (active) setWorksData(value); })
            .catch(() => { if (active) setWorksError(true); });
        return () => { active = false; };
    }, [worksAttempt]);
    const categories = useMemo(() => ["全部", ...new Set(worksData?.map((w) => w.category) || [])], [worksData]);
    const works = useMemo(() => (worksData || []).filter((w) => (category === "全部" || w.category === category) && `${w.title} ${w.category} ${w.prompt}`.toLowerCase().includes(query.toLowerCase())), [worksData, category, query]);
    const go = (path: string) => { if (!requireAuth(path)) navigate(path); };
    const enabled = (kind: string) => kind === "image" ? services.imageEnabled : kind === "video" ? services.videoEnabled : true;
    const hero = config?.hero;
    return <main className={styles.page}>
        {configError ? <div className="p-6"><Alert type="error" title="首页品牌内容暂时无法加载" action={<Button onClick={() => setConfigAttempt((v) => v + 1)}>重试</Button>} /></div> : null}
        {config === undefined && !configError ? <div className="p-8"><Skeleton active paragraph={{ rows: 8 }} /></div> : null}
        {hero ? <section className={styles.hero}>
            {hero.media ? <img className={styles.heroImage} src={hero.media.url} srcSet={responsive(hero.media)} sizes="(max-width:639px) 1200px, (min-width:1200px) calc(100vw - 216px), 100vw" alt={hero.title.replace(/\n/g, "")} loading="eager" decoding="async" fetchPriority="high" /> : null}
            <div className={styles.heroCopy}><div className={styles.eyebrow}><span />从灵感，到下一部作品</div><h1>{hero.title}</h1><p>{hero.subtitle}</p>
                <div className="mt-8 flex flex-wrap gap-3"><Button className={styles.heroPrimary} type="primary" size="large" icon={<ArrowRight size={18} />} iconPlacement="end" onClick={() => go("/canvas")}>开始创作</Button><Button className={styles.heroSecondary} size="large" onClick={() => document.getElementById("inspiration")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}>探索示例 <ArrowDown size={16} /></Button></div>
            </div>
        </section> : null}
        {config?.entries.length ? <section aria-label="创作工具" className={styles.entries}>{config.entries.filter((e) => enabled(e.kind)).map((entry) => <button key={entry.kind} onClick={() => go(`/${entry.kind}`)} className={styles.entry}>
            {entry.media ? <img src={entry.media.mediumUrl} srcSet={responsive(entry.media)} sizes="(max-width:767px) 90vw, 30vw" alt="" loading="eager" decoding="async" /> : null}<div><h2>{entry.title}</h2><p>{entry.description}</p></div><span className={styles.round}>{entry.kind === "video" ? <Play size={20} /> : <ArrowRight size={20} />}</span>
        </button>)}</section> : null}
        <section id="inspiration" className={styles.gallery} aria-busy={worksData === null && !worksError}>
            <div className={styles.galleryHeader}><h2>精选灵感</h2><div className={styles.filters}>{categories.map((c) => <button key={c} aria-pressed={c === category} onClick={() => setCategory(c)}>{c}</button>)}</div><label className={styles.search}><Search size={16} /><input aria-label="搜索作品" placeholder="搜索作品" value={query} onChange={(e) => { const next = new URLSearchParams(params); e.target.value ? next.set("q", e.target.value) : next.delete("q"); setParams(next, { replace: true }); }} /></label></div>
            {worksError ? <Alert className="mb-4" type="error" title="精选灵感暂时无法加载" action={<Button onClick={() => setWorksAttempt((v) => v + 1)}>重试</Button>} /> : null}
            {worksData === null && !worksError ? <div className="py-8 text-center text-sm text-muted-foreground" role="status">正在加载精选作品…</div> : null}
            {worksData ? <div className={styles.grid}>{works.map((work) => { const cover = work.kind === "video" ? work.poster : work.media; return <button key={work.id} className={styles.work} onClick={() => setPreview(work)} aria-label={`预览${work.title}`}>{cover ? <img src={cover.mediumUrl} srcSet={responsive(cover)} sizes="(max-width:640px) 90vw, (max-width:1024px) 45vw, 23vw" alt={work.title} loading="lazy" decoding="async" fetchPriority="low" /> : null}<div><span>{work.category}</span><h3>{work.title}</h3></div>{work.kind === "video" ? <span className={styles.play}><Play size={20} /></span> : null}</button>; })}</div> : null}
            {worksData && !works.length ? <Empty description={query || category !== "全部" ? "没有匹配的作品" : "精选作品正在准备中"} className="py-16" /> : null}
        </section>
        <footer className={styles.footer}><span>更大的想象，正在发生。</span><span>图像 · 视频 · 无限画布</span></footer>
        <Modal open={!!preview} title={preview?.title} onCancel={() => setPreview(null)} width={960} footer={null} destroyOnHidden>{preview ? <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_240px]">
            <div className="grid min-h-40 place-items-center overflow-hidden rounded-lg bg-background">{preview.kind === "video" ? <video src={preview.media.url} poster={preview.poster?.mediumUrl} controls className="max-h-[65vh] w-full" /> : <img src={preview.media.url} alt={preview.title} className="max-h-[65vh] w-full object-contain" />}</div>
            <div className="flex flex-col gap-4"><span className="text-primary">{preview.category}</span><h3 className="font-medium">创作提示词</h3><p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{preview.prompt || "此作品未公开提示词"}</p><Button type="primary" disabled={!preview.prompt.trim() || !enabled(preview.kind)} onClick={() => go(`/${preview.kind}?showcase=${encodeURIComponent(preview.id)}`)}>创作同款 <ArrowRight size={16} /></Button><p className="text-xs text-muted-foreground">带入公开提示词，在工作台确认参数后开始生成。</p></div>
        </div> : null}</Modal>
    </main>;
}
