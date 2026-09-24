import { describe, expect, it } from "vitest";
import { applyMultiplier, coefficientFromSurcharge, effectiveMultiplier, isNeutralMultiplier, NEUTRAL_MULTIPLIER } from "./reseller-multiplier";

describe("reseller multiplier", () => {
    it("turns a signed surcharge into a coefficient", () => {
        expect(coefficientFromSurcharge("0.2")).toBe("1.200000");
        expect(coefficientFromSurcharge("-0.2")).toBe("0.800000");
        expect(coefficientFromSurcharge("0")).toBe(NEUTRAL_MULTIPLIER);
    });

    it("clamps a surcharge that would make generation free or negative", () => {
        expect(coefficientFromSurcharge("-1")).toBe("0.000000");
        expect(coefficientFromSurcharge("-2.5")).toBe("0.000000");
    });

    it("prefers the per-account override over the tier", () => {
        expect(effectiveMultiplier({ status: "approved", multiplierOverride: "-0.3", tierMultiplier: "0.2" })).toBe("0.700000");
    });

    it("falls back to the tier when there is no override", () => {
        expect(effectiveMultiplier({ status: "approved", multiplierOverride: null, tierMultiplier: "0.2" })).toBe("1.200000");
    });

    it("charges public price when the account has neither override nor tier", () => {
        expect(effectiveMultiplier({ status: "approved", multiplierOverride: null, tierMultiplier: null })).toBe(NEUTRAL_MULTIPLIER);
    });

    it("does not apply discounts to suspended or missing accounts", () => {
        for (const status of ["suspended", "unknown"]) {
            expect(effectiveMultiplier({ status, multiplierOverride: "-0.5", tierMultiplier: "-0.5" })).toBe(NEUTRAL_MULTIPLIER);
        }
        expect(effectiveMultiplier(null)).toBe(NEUTRAL_MULTIPLIER);
        expect(effectiveMultiplier(undefined)).toBe(NEUTRAL_MULTIPLIER);
    });

    it("retains approved pricing throughout a tier-upgrade review", () => {
        for (const status of ["pending", "rejected", "approved"]) {
            expect(effectiveMultiplier({ status, tierMultiplier: "-0.1" })).toBe("0.900000");
            expect(effectiveMultiplier({ status, multiplierOverride: "-0.2" })).toBe("0.800000");
            expect(effectiveMultiplier({ status })).toBe("1.000000");
        }
    });

    it("treats a zero surcharge override as an explicit public price, not as absent", () => {
        expect(effectiveMultiplier({ status: "approved", multiplierOverride: "0.000000", tierMultiplier: "0.2" })).toBe(NEUTRAL_MULTIPLIER);
    });

    it("applies the coefficient to an amount", () => {
        // The worked example from the spec: ¥0.3/image at +0.2 and -0.2.
        expect(applyMultiplier("0.3", "1.200000").toFixed(6)).toBe("0.360000");
        expect(applyMultiplier("0.3", "0.800000").toFixed(6)).toBe("0.240000");
    });

    it("skips the multiplication entirely when the coefficient is neutral or missing", () => {
        expect(isNeutralMultiplier(undefined)).toBe(true);
        expect(isNeutralMultiplier("1")).toBe(true);
        expect(isNeutralMultiplier("1.000000")).toBe(true);
        expect(isNeutralMultiplier("1.200000")).toBe(false);
        expect(applyMultiplier("0.3", undefined).toFixed(6)).toBe("0.300000");
    });
});
