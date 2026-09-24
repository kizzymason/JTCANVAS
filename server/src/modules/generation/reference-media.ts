import { badRequest } from "../../common/errors";
import type { GenerationReferenceDto } from "./dto/generation.dto";

export const mediaMime = { image: "image/png", video: "video/mp4", audio: "audio/mpeg" } as const;

export function mimeFromReferenceUrl(value: string) {
    const pathname = value.split("?")[0]?.toLowerCase() ?? "";
    if (/\.(mp4|mov|webm|mkv)$/.test(pathname)) return "video/mp4";
    if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(pathname)) return "audio/mpeg";
    if (/\.jpe?g$/.test(pathname)) return "image/jpeg";
    if (pathname.endsWith(".webp")) return "image/webp";
    return "image/png";
}

/** Uses the existing reference-image ceiling; decoding never persists the data URL in task JSON. */
export function decodeReferenceImage(value: string) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match) throw badRequest("INVALID_REFERENCE", "参考图必须是 PNG、JPEG 或 WebP 的 Base64 data URL");
    const body = Buffer.from(match[2]!, "base64");
    if (!body.length || body.toString("base64").replace(/=+$/, "") !== match[2]!.replace(/=+$/, "")) throw badRequest("INVALID_REFERENCE", "参考图 Base64 无效");
    if (body.length > 10 * 1024 * 1024) throw badRequest("REFERENCE_TOO_LARGE", "单张参考图不能超过 10MB");
    return { body, mimeType: match[1]! };
}

export function assertReferenceKind(mimeType: string, reference?: GenerationReferenceDto) {
    if (reference && !mimeType.startsWith(`${reference.type}/`)) throw badRequest("REFERENCE_TYPE_MISMATCH", "参考素材实际类型与声明的图片、视频或音频类型不一致");
    if (reference?.role && !(reference.type === "image" ? ["first_frame", "last_frame", "reference_image"] : [`reference_${reference.type}`]).includes(reference.role)) {
        throw badRequest("INVALID_REFERENCE_ROLE", "参考素材类型与 role 不一致");
    }
}
