import { timingSafeEqual } from "node:crypto";
import { badRequest, unauthorized } from "../../common/errors";

export type HmacFn = (message: string) => string;

/** True when PiAPI (or any remote crawler) can fetch the URL over the public internet. */
export function isPublicHttpUrl(value: string) {
    try {
        const url = new URL(value.trim());
        if (url.protocol !== "http:" && url.protocol !== "https:") return false;
        const host = url.hostname.toLowerCase();
        if (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return false;
        if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
        return true;
    } catch {
        return false;
    }
}

export function publicFileToken(hmac: HmacFn, storageKey: string, expiresAtUnix: number) {
    return `${expiresAtUnix}.${hmac(`${storageKey}:${expiresAtUnix}`)}`;
}

export function assertPublicFileToken(hmac: HmacFn, storageKey: string, token: string) {
    const trimmed = token.trim();
    const dot = trimmed.indexOf(".");
    if (dot <= 0) throw unauthorized("文件链接无效");
    const expiresAtUnix = Number(trimmed.slice(0, dot));
    const signature = trimmed.slice(dot + 1);
    if (!Number.isFinite(expiresAtUnix) || !signature) throw unauthorized("文件链接无效");
    if (expiresAtUnix * 1000 < Date.now()) throw unauthorized("文件链接已过期");
    const expected = hmac(`${storageKey}:${expiresAtUnix}`);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) throw unauthorized("文件链接无效");
}

export function publicFileAbsoluteUrl(publicBase: string, storageKey: string, token: string) {
    if (!isPublicHttpUrl(publicBase)) throw badRequest("PUBLIC_URL_REQUIRED", "未配置可被 PiAPI 访问的公网地址 APP_PUBLIC_URL");
    const origin = publicBase.replace(/\/$/, "");
    // Path token (no query string): PiAPI's crawler has historically dropped `?token=` signed URLs.
    return `${origin}/api/files/${encodeURIComponent(storageKey)}/token/${encodeURIComponent(token)}`;
}
