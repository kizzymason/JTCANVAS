import { describe, expect, it } from "vitest";
import { asInt, toIsoTimestamptz } from "./admin-overview";

describe("toIsoTimestamptz", () => {
    it("emits ISO-8601 so postgres.js does not send Date.toString()", () => {
        const at = new Date("2026-08-26T18:51:26.000Z");
        expect(toIsoTimestamptz(at)).toBe("2026-08-26T18:51:26.000Z");
        expect(toIsoTimestamptz(at)).not.toMatch(/GMT|Wed|Aug/);
    });
});

describe("asInt", () => {
    it("coerces postgres count payloads to integers", () => {
        expect(asInt(3)).toBe(3);
        expect(asInt("12")).toBe(12);
        expect(asInt(4n)).toBe(4);
        expect(asInt(null)).toBe(0);
        expect(asInt(undefined)).toBe(0);
        expect(asInt(Number.NaN)).toBe(0);
        expect(asInt("")).toBe(0);
    });
});
