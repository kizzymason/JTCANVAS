import { describe, expect, it } from "vitest";
import { JOIN_COMMUNITY_CONTENT } from "./announcements.seed";
import {
    announcementContentIsEmpty,
    announcementMediaUrl,
    announcementStorageKeysFromHtml,
    sanitizeAnnouncementHtml,
    storageKeyFromPublicUrl,
} from "./announcement-html";

describe("sanitizeAnnouncementHtml", () => {
    it("strips script tags and event handlers", () => {
        const html = `<p onclick="alert(1)">hi</p><script>alert(1)</script><img src="/announcements/community-qr-placeholder.svg" onerror="alert(1)" alt="qr">`;
        const out = sanitizeAnnouncementHtml(html);
        expect(out).toContain("<p>hi</p>");
        expect(out).not.toContain("script");
        expect(out).not.toContain("onclick");
        expect(out).not.toContain("onerror");
        expect(out).toContain('src="/announcements/community-qr-placeholder.svg"');
    });

    it("rejects javascript urls", () => {
        const html = sanitizeAnnouncementHtml(`<a href="javascript:alert(1)">x</a><img src="javascript:alert(1)">`);
        expect(html).not.toMatch(/javascript/i);
        expect(html).toContain("x");
    });

    it("keeps announcement media urls and extracts storage keys", () => {
        const key = "announcement:11111111-2222-4333-8444-555555555555";
        const src = announcementMediaUrl(key);
        const html = `<p>群号 XXX</p><img src="${src}" alt="qr">`;
        const out = sanitizeAnnouncementHtml(html);
        expect(out).toContain(src);
        expect(announcementStorageKeysFromHtml(out)).toEqual([key]);
        expect(storageKeyFromPublicUrl(src)).toBe(key);
    });

    it("keeps the seeded join-community body including the placeholder QR", () => {
        const out = sanitizeAnnouncementHtml(JOIN_COMMUNITY_CONTENT);
        expect(announcementContentIsEmpty(out)).toBe(false);
        expect(out).toContain("XXX");
        expect(out).toContain("/announcements/community-qr-placeholder.svg");
        expect(out).not.toMatch(/<script/i);
    });
});
