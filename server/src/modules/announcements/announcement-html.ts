/** Announcement images are stored with this prefix so the public media route cannot serve other files. */
export const ANNOUNCEMENT_FILE_PREFIX = "announcement:";

export const JOIN_COMMUNITY_SLUG = "join-community";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_TAGS = new Set([
    "p",
    "br",
    "div",
    "span",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "strike",
    "del",
    "ul",
    "ol",
    "li",
    "blockquote",
    "pre",
    "code",
    "hr",
    "a",
    "img",
    "figure",
    "figcaption",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "sub",
    "sup",
]);

const VOID_TAGS = new Set(["br", "hr", "img"]);

const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "noscript", "template"]);

const ALLOWED_STYLES = new Set([
    "color",
    "background-color",
    "text-align",
    "font-size",
    "font-weight",
    "font-style",
    "text-decoration",
    "width",
    "max-width",
    "height",
    "margin",
    "margin-left",
    "margin-right",
    "margin-top",
    "margin-bottom",
    "padding",
    "line-height",
    "border-radius",
    "display",
]);

const STYLE_VALUE_RE = /^(?!.*(?:expression|javascript|url\s*\())[\w\s#%,./()-]+$/i;

export function isUuid(value: string) {
    return UUID_RE.test(value);
}

export function isAnnouncementStorageKey(storageKey: string) {
    return storageKey.startsWith(ANNOUNCEMENT_FILE_PREFIX);
}

/** Collects announcement: storage keys referenced by img src in saved HTML. */
export function announcementStorageKeysFromHtml(html: string) {
    const keys = new Set<string>();
    const re = /(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html))) {
        const raw = decodeHtml(match[1] ?? match[2] ?? "").trim();
        const key = storageKeyFromPublicUrl(raw);
        if (key) keys.add(key);
    }
    return [...keys];
}

export function announcementMediaUrl(storageKey: string) {
    return `/api/announcements/media/${encodeURIComponent(storageKey)}`;
}

export function storageKeyFromPublicUrl(src: string) {
    try {
        const path = src.startsWith("http://") || src.startsWith("https://") ? new URL(src).pathname : src.split("?")[0];
        const prefix = "/api/announcements/media/";
        const idx = path.indexOf(prefix);
        if (idx < 0) return null;
        const encoded = path.slice(idx + prefix.length);
        const key = decodeURIComponent(encoded);
        return isAnnouncementStorageKey(key) ? key : null;
    } catch {
        return null;
    }
}

/**
 * Allowlist sanitizer for admin-authored HTML. Strips scripts and event handlers so a pasted
 * snippet cannot become stored XSS for every visitor.
 */
export function sanitizeAnnouncementHtml(html: string) {
    let input = String(html ?? "");
    input = input.replace(/<!--[\s\S]*?-->/g, "");
    for (const tag of DROP_WITH_CONTENT) {
        const block = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
        const open = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi");
        input = input.replace(block, "").replace(open, "");
    }

    return input.replace(/<\/?([a-zA-Z][a-zA-Z0-9:-]*)\b([^>]*)>/g, (full, rawName: string, rawAttrs: string) => {
        const name = rawName.toLowerCase();
        const closing = full.startsWith("</");
        if (!ALLOWED_TAGS.has(name)) return "";
        if (closing) return VOID_TAGS.has(name) ? "" : `</${name}>`;
        const attrs = sanitizeAttributes(name, rawAttrs);
        if (attrs === null) return "";
        return `<${name}${attrs}>`;
    });
}

export function announcementContentIsEmpty(html: string) {
    const text = sanitizeAnnouncementHtml(html)
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (text) return false;
    return !/<img\b/i.test(html);
}

function sanitizeAttributes(tag: string, raw: string) {
    const parts: string[] = [];
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
    let match: RegExpExecArray | null;
    let href = "";
    let src = "";
    while ((match = re.exec(raw))) {
        const name = match[1].toLowerCase();
        const value = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
        if (name.startsWith("on") || name === "srcset" || name === "srcdoc") continue;
        if (name === "style") {
            const style = sanitizeStyle(value);
            if (style) parts.push(`style="${escapeAttr(style)}"`);
            continue;
        }
        if (tag === "a" && name === "href") {
            if (!isSafeHref(value)) return null;
            href = value.trim();
            parts.push(`href="${escapeAttr(href)}"`);
            continue;
        }
        if (tag === "img" && name === "src") {
            if (!isSafeSrc(value)) return null;
            src = value.trim();
            parts.push(`src="${escapeAttr(src)}"`);
            continue;
        }
        if (tag === "img" && (name === "alt" || name === "width" || name === "height")) {
            parts.push(`${name}="${escapeAttr(value)}"`);
            continue;
        }
        if ((tag === "td" || tag === "th") && (name === "colspan" || name === "rowspan") && /^\d{1,2}$/.test(value)) {
            parts.push(`${name}="${value}"`);
        }
    }
    if (tag === "img" && !src) return null;
    if (tag === "a" && href) {
        parts.push('rel="noopener noreferrer"');
        if (!parts.some((part) => part.startsWith("target="))) parts.push('target="_blank"');
    }
    return parts.length ? ` ${parts.join(" ")}` : "";
}

function sanitizeStyle(value: string) {
    return value
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .flatMap((part) => {
            const colon = part.indexOf(":");
            if (colon <= 0) return [];
            const prop = part.slice(0, colon).trim().toLowerCase();
            const val = part.slice(colon + 1).trim();
            if (!ALLOWED_STYLES.has(prop) || !STYLE_VALUE_RE.test(val)) return [];
            return [`${prop}: ${val}`];
        })
        .join("; ");
}

function isSafeHref(value: string) {
    const href = value.trim().toLowerCase();
    if (!href || href.startsWith("javascript:") || href.startsWith("data:") || href.startsWith("vbscript:")) return false;
    return /^(https?:|mailto:|\/|#)/i.test(value.trim());
}

function isSafeSrc(value: string) {
    const src = value.trim();
    if (!src || src.toLowerCase().startsWith("javascript:") || src.toLowerCase().startsWith("data:")) return false;
    if (src.startsWith("/announcements/") && !src.includes("..")) return true;
    if (src.startsWith("/api/announcements/media/")) return true;
    return /^https?:\/\//i.test(src);
}

function decodeHtml(value: string) {
    return value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
}

function escapeAttr(value: string) {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
