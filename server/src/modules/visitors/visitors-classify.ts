import type { VisitorKind } from "../../db/schema";

export const SITEWIDE_PATH = "*";
export const VISITOR_DETAIL_RETENTION_DAYS = 30;
export const VISITOR_UV_TTL_SECONDS = 3 * 24 * 60 * 60;
export const BOT_LANDING_THROTTLE_SECONDS = 30 * 60;
export const BURST_WINDOW_SECONDS = 10;
export const BURST_HIT_THRESHOLD = 8;
export const VISITOR_COOKIE = "ic_vid";
export const VISITOR_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

const BOT_UA_RE =
    /googlebot|bingbot|baiduspider|yandexbot|duckduckbot|slurp|facebookexternalhit|twitterbot|linkedinbot|discordbot|telegrambot|whatsapp|applebot|semrushbot|ahrefsbot|dotbot|mj12bot|petalbot|bytespider|gptbot|chatgpt-user|claudebot|anthropic-ai|ccbot|curl\/|wget\/|python-requests|python-urllib|go-http-client|java\/|apache-httpclient|okhttp|postmanruntime|insomnia\/|httpie|scrapy|aiohttp|libwww-perl|php\/|sqlmap|nikto|nmap|masscan|zgrab|nuclei|dirbuster|gobuster|wfuzz|nessus|openvas|scanner|crawler|spider|bot\/|headlesschrome/i;

export function isBotUserAgent(ua: string) {
    return BOT_UA_RE.test(ua);
}

export function isIncompleteUserAgent(ua: string) {
    const trimmed = ua.trim();
    return trimmed.length < 12 || !/[A-Za-z]/.test(trimmed);
}

export function looksLikeBrowser(ua: string) {
    return /mozilla|chrome|safari|firefox|edg\/|opr\/|applewebkit|crios|fxios/i.test(ua);
}

/** Drop query strings, reject admin routes, cap length. Returns null when the hit should not be stored. */
export function normalizeVisitorPath(raw: string | undefined | null): string | null {
    if (!raw) return null;
    let path = raw.trim();
    if (!path.startsWith("/")) path = `/${path}`;
    const cut = path.search(/[?#]/);
    if (cut >= 0) path = path.slice(0, cut);
    path = path.replace(/\/{2,}/g, "/") || "/";
    if (path.length > 200) path = path.slice(0, 200);
    if (path === "/admin" || path.startsWith("/admin/")) return null;
    return path;
}

export function utcDateString(at = new Date()) {
    return at.toISOString().slice(0, 10);
}

export function eachUtcDate(from: string, to: string) {
    const dates: string[] = [];
    const cursor = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    while (cursor.getTime() <= end.getTime()) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
}

export function classifyVisitor(input: { ua: string; webdriver?: boolean; burst?: boolean }): VisitorKind {
    if (isBotUserAgent(input.ua)) return "bot";
    if (input.webdriver || input.burst || isIncompleteUserAgent(input.ua) || !looksLikeBrowser(input.ua)) return "suspected";
    return "human";
}

export function deviceSummary(input: { ua: string; screen?: string; timezone?: string }) {
    const platform = /windows/i.test(input.ua)
        ? "Windows"
        : /mac os|macintosh/i.test(input.ua)
          ? "macOS"
          : /android/i.test(input.ua)
            ? "Android"
            : /iphone|ipad|ios/i.test(input.ua)
              ? "iOS"
              : /linux/i.test(input.ua)
                ? "Linux"
                : "Unknown";
    return [platform, input.screen?.trim(), input.timezone?.trim()].filter(Boolean).join(" · ").slice(0, 256);
}

export function isVisitorId(value: string | undefined) {
    return Boolean(value && /^[A-Za-z0-9_-]{16,64}$/.test(value));
}
