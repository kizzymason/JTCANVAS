import { serviceDisabled } from "../../common/errors";
import type { SiteSettings } from "./settings.service";

/** Blocks billed generation when the matching product surface has been turned off in admin. */
export function assertGenerationEnabled(site: SiteSettings, capability: string) {
    if (capability === "image" && !site.imageGenerationEnabled) throw serviceDisabled("图片生成服务已关闭");
    if (capability === "video" && !site.videoGenerationEnabled) throw serviceDisabled("视频生成服务已关闭");
}
