import { badRequest } from "../../../common/errors";
import type { ReferenceInput } from "./provider.types";

/** Seedream accepts at most ten public reference URLs. Extra refs on Pro cost $0.003 each. */
export const PIAPI_MAX_REFERENCE_IMAGES = 10;
/** PiAPI ephemeral upload rejects files larger than 10MB. */
export const PIAPI_MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
export const PIAPI_EPHEMERAL_UPLOAD_URL = "https://upload.theapi.app/api/ephemeral_resource";

const MIME_EXTENSION: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
};

const EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

/**
 * Seedream `image_urls` only accept public http(s). The worker already has the bytes from our
 * private store, so it re-hosts them on PiAPI's ephemeral CDN (browser CORS does not apply here).
 */
export function assertPiapiReferences(references: ReferenceInput[], mask?: ReferenceInput) {
    if (mask) throw badRequest("PIAPI_MASK_UNSUPPORTED", "PiAPI 渠道暂不支持蒙版编辑");
    if (references.length > PIAPI_MAX_REFERENCE_IMAGES) {
        throw badRequest("PIAPI_TOO_MANY_REFERENCES", `PiAPI 最多支持 ${PIAPI_MAX_REFERENCE_IMAGES} 张参考图`);
    }
    for (const reference of references) {
        if (reference.body.byteLength > PIAPI_MAX_REFERENCE_BYTES) {
            throw badRequest("PIAPI_REFERENCE_TOO_LARGE", "单张参考图不能超过 10MB");
        }
        ephemeralFileName(reference.fileName, reference.mimeType);
    }
}

/** PiAPI validates the extension against the data-URI content type. */
export function ephemeralFileName(fileName: string, mimeType: string) {
    const mime = mimeType.trim().toLowerCase();
    const ext = MIME_EXTENSION[mime];
    if (!ext) throw badRequest("PIAPI_REFERENCE_TYPE", "PiAPI 参考图只支持 JPG、PNG 或 WebP");
    const base = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "") || "reference";
    const current = base.split(".").pop()?.toLowerCase() ?? "";
    const withExt = EXTENSIONS.has(current) ? base.replace(/\.[^.]+$/, `.${ext}`) : `${base}.${ext}`;
    return withExt.slice(0, 128);
}

export function ephemeralFileData(body: Buffer, mimeType: string) {
    const mime = mimeType.trim().toLowerCase();
    const mapped = MIME_EXTENSION[mime] ? (mime === "image/jpg" ? "image/jpeg" : mime) : mime;
    return `data:${mapped};base64,${body.toString("base64")}`;
}

export function piapiSeedreamInput(params: { prompt: string; aspectRatio: string; size: string; outputFormat: string; imageUrls: string[] }) {
    return {
        prompt: params.prompt,
        aspect_ratio: params.aspectRatio,
        output_format: params.outputFormat,
        size: params.size,
        ...(params.imageUrls.length ? { image_urls: params.imageUrls } : {}),
    };
}

export function ephemeralUploadUrl(payload: { code?: number; data?: { url?: string } | null; message?: string } | undefined) {
    const url = payload?.data?.url?.trim();
    const code = payload?.code;
    if (!url || (code !== undefined && code !== 200)) {
        throw badRequest("PIAPI_UPLOAD_FAILED", payload?.message || "参考图上传到 PiAPI 临时图床失败");
    }
    if (!/^https?:\/\//i.test(url)) throw badRequest("PIAPI_UPLOAD_FAILED", "PiAPI 临时图床没有返回公网地址");
    return url;
}
