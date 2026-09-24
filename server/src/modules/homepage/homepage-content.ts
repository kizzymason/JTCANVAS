import type { HomeConfig, HomeMedia } from "../../db/schema/homepage";

export const brandKeys = ["hero", "image", "video", "canvas", "architecture", "ice", "clouds", "panther"] as const;
const brand = (key: string): HomeMedia => ({ source: "brand", key });
export const initialHomeConfig: HomeConfig = {
    hero: { title: "让想象，\n成为作品。", subtitle: "图像、视频与无限画布，一站式 AI 创作。", visible: true, media: brand("hero") },
    entries: [
        { kind: "image", title: "图片生成", description: "用 AI 生成惊艳的图像", visible: true, media: brand("image") },
        { kind: "video", title: "视频生成", description: "让画面动起来", visible: true, media: brand("video") },
        { kind: "canvas", title: "无限画布", description: "在无边界中自由创作", visible: true, media: brand("canvas") },
    ],
};
export const initialWorks = [
    { title: "天地之间", category: "建筑", media: brand("architecture"), prompt: "身穿墨绿色长裙的女子站在白色弧形建筑阶梯上，远山与云海，阳光，时尚大片。" },
    { title: "冰与光", category: "人像", media: brand("ice"), prompt: "冰晶与水滴环绕的女性人像特写，白发，通透玻璃质感，温暖高光与冷色阴影，精细摄影。" },
    { title: "云上居所", category: "建筑", media: brand("clouds"), prompt: "粉色云海中的悬浮玻璃住宅，樱花枝条，远处蓝色行星，梦幻建筑摄影。" },
    { title: "丛林之眼", category: "自然", media: brand("panther"), prompt: "黑豹与白色花朵，深绿丛林，明亮绿色眼睛，细腻毛发，自然斑驳光影，电影感摄影。" },
].map((work, sortOrder) => ({ ...work, kind: "image" as const, poster: null, published: true, sortOrder }));

export function configMedia(config: HomeConfig | null): HomeMedia[] {
    return config ? [config.hero.media, ...config.entries.map((e) => e.media)].filter((m): m is HomeMedia => Boolean(m)) : [];
}
export function visibleConfigMedia(config: HomeConfig | null): HomeMedia[] {
    return config ? [config.hero.visible ? config.hero.media : null, ...config.entries.filter((e) => e.visible).map((e) => e.media)].filter((m): m is HomeMedia => Boolean(m)) : [];
}
export function publicMedia(media: HomeMedia | null, variant = "original") {
    if (!media) return null;
    if (media.source === "brand") return { url: `/brand/gravity/${media.key}-2560.webp`, thumbUrl: `/brand/gravity/${media.key}-640.webp`, mediumUrl: `/brand/gravity/${media.key}-1280.webp` };
    const url = `/api/homepage/media/${encodeURIComponent(media.key)}`;
    return { url: `${url}?variant=${variant}`, thumbUrl: `${url}?variant=thumb`, mediumUrl: `${url}?variant=medium` };
}
