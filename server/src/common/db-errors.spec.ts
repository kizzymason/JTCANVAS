import { describe, expect, it } from "vitest";
import { hasSqlState, isUniqueViolation } from "./db-errors";

describe("isUniqueViolation", () => {
    it("recognises a bare driver error", () => {
        expect(isUniqueViolation(Object.assign(new Error("dup"), { code: "23505" }))).toBe(true);
    });

    it("finds the code through Drizzle's wrapper, where it actually arrives", () => {
        const driver = Object.assign(new Error("duplicate key"), { code: "23505" });
        const wrapped = new Error("Failed query: insert into ...", { cause: driver });
        expect(isUniqueViolation(wrapped)).toBe(true);
    });

    it("finds it through more than one layer of wrapping", () => {
        const driver = Object.assign(new Error("duplicate key"), { code: "23505" });
        expect(isUniqueViolation(new Error("outer", { cause: new Error("inner", { cause: driver }) }))).toBe(true);
    });

    it("does not mistake other database errors for a duplicate", () => {
        const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
        expect(isUniqueViolation(new Error("Failed query", { cause: deadlock }))).toBe(false);
        expect(isUniqueViolation(new Error("plain"))).toBe(false);
        expect(isUniqueViolation(null)).toBe(false);
        expect(isUniqueViolation(undefined)).toBe(false);
        expect(isUniqueViolation("a string")).toBe(false);
    });

    it("does not loop forever on a self-referencing cause", () => {
        const looping = new Error("loop");
        Object.defineProperty(looping, "cause", { value: looping });
        expect(isUniqueViolation(looping)).toBe(false);
    });

    it("gives up rather than digging arbitrarily deep", () => {
        // Six layers with the real error at the bottom: deeper than we are willing to walk.
        let error: unknown = Object.assign(new Error("dup"), { code: "23505" });
        for (let index = 0; index < 6; index += 1) error = new Error(`layer ${index}`, { cause: error });
        expect(isUniqueViolation(error)).toBe(false);
    });
});

describe("hasSqlState", () => {
    it("matches any state the caller names", () => {
        const deadlock = Object.assign(new Error("deadlock"), { code: "40P01" });
        expect(hasSqlState(new Error("wrapped", { cause: deadlock }), "40P01")).toBe(true);
        expect(hasSqlState(new Error("wrapped", { cause: deadlock }), "23505")).toBe(false);
    });
});
