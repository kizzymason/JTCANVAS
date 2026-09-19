import { describe, expect, it } from "vitest";
import { parseCodes } from "./card-shop.admin.service";
import { createCardOrderNo, maskEmail, normalizeEmail } from "./card-shop.service";

describe("parseCodes", () => {
    it("accepts one code per line and upper-cases them", () => {
        expect(parseCodes("abcd-efgh\nijkl-mnop\n").codes).toEqual(["ABCD-EFGH", "IJKL-MNOP"]);
    });

    it("also splits on commas, semicolons and stray whitespace", () => {
        expect(parseCodes("A-1, B-2; C-3\t D-4").codes).toEqual(["A-1", "B-2", "C-3", "D-4"]);
    });

    it("reports duplicates inside one paste instead of counting them as stock", () => {
        const parsed = parseCodes("A-1\nA-1\na-1\nB-2");
        expect(parsed.codes).toEqual(["A-1", "B-2"]);
        expect(parsed.duplicates).toBe(2);
    });

    it("ignores blank input", () => {
        expect(parseCodes("   \n\n ").codes).toEqual([]);
    });
});

describe("normalizeEmail", () => {
    it("lower-cases and trims so look-up matches what was typed at checkout", () => {
        expect(normalizeEmail("  Buyer@Example.COM ")).toBe("buyer@example.com");
    });
});

describe("maskEmail", () => {
    it("keeps enough of the address for the buyer to recognise it", () => {
        expect(maskEmail("buyer@example.com")).toBe("bu***@example.com");
        expect(maskEmail("ab@example.com")).toBe("ab@example.com");
    });

    it("leaves a malformed address alone rather than throwing", () => {
        expect(maskEmail("not-an-email")).toBe("not-an-email");
    });
});

describe("createCardOrderNo", () => {
    it("is prefixed so card sales are distinguishable from wallet orders in the gateway", () => {
        const orderNo = createCardOrderNo();
        expect(orderNo.startsWith("C")).toBe(true);
        expect(orderNo).toMatch(/^C\d{14}[0-9A-F]{8}$/);
    });

    it("does not collide across a burst of orders", () => {
        const seen = new Set(Array.from({ length: 500 }, () => createCardOrderNo()));
        expect(seen.size).toBe(500);
    });
});
