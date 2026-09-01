import { describe, expect, it } from "vitest";
import { classifyVisitor, eachUtcDate, isBotUserAgent, isIncompleteUserAgent, normalizeVisitorPath } from "./visitors-classify";

describe("normalizeVisitorPath", () => {
    it("strips query strings and rejects admin routes", () => {
        expect(normalizeVisitorPath("/canvas?x=1")).toBe("/canvas");
        expect(normalizeVisitorPath("image#top")).toBe("/image");
        expect(normalizeVisitorPath("/admin")).toBeNull();
        expect(normalizeVisitorPath("/admin/users")).toBeNull();
        expect(normalizeVisitorPath("/")).toBe("/");
    });
});

describe("classifyVisitor", () => {
    it("tags known crawlers as bot", () => {
        expect(isBotUserAgent("Mozilla/5.0 Googlebot/2.1")).toBe(true);
        expect(classifyVisitor({ ua: "python-requests/2.31.0" })).toBe("bot");
        expect(classifyVisitor({ ua: "sqlmap/1.7" })).toBe("bot");
    });

    it("tags webdriver, burst and broken UA as suspected", () => {
        expect(classifyVisitor({ ua: "Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36", webdriver: true })).toBe("suspected");
        expect(classifyVisitor({ ua: "Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36", burst: true })).toBe("suspected");
        expect(isIncompleteUserAgent("ok")).toBe(true);
        expect(classifyVisitor({ ua: "" })).toBe("suspected");
    });

    it("tags a normal browser beacon as human", () => {
        expect(classifyVisitor({ ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36" })).toBe("human");
    });
});

describe("eachUtcDate", () => {
    it("includes both ends", () => {
        expect(eachUtcDate("2026-09-01", "2026-09-03")).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    });
});
