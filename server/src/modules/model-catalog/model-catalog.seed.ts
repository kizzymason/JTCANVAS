import type { ModelBadge } from "../../db/schema";

/**
 * 首次启动时写入的默认分组，让后台不是空的。
 * 用 key 作为冲突键，管理员改过名字或排序之后不会被再次覆盖。
 */
export const DEFAULT_MODEL_GROUPS: Array<{ key: string; name: string; description: string; sortOrder: number }> = [
    { key: "featured", name: "推荐模型", description: "工作台默认优先展示的模型", sortOrder: 10 },
    { key: "image", name: "图片模型", description: "文生图与图生图", sortOrder: 20 },
    { key: "video", name: "视频模型", description: "文生视频与图生视频", sortOrder: 30 },
    { key: "text", name: "文本模型", description: "文案与提示词扩写", sortOrder: 40 },
];

/** 后台可以自由增删标识，这里只提供几个常用预设供一键填入。 */
export const BADGE_PRESETS: ModelBadge[] = [
    { key: "latest", label: "最新", tone: "primary" },
    { key: "recommended", label: "推荐", tone: "primary" },
    { key: "hot", label: "热门", tone: "warning" },
    { key: "fast", label: "极速", tone: "neutral" },
    { key: "hd", label: "高清", tone: "neutral" },
    { key: "new", label: "新上线", tone: "warning" },
];
