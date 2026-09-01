import { describe, expect, it } from "vitest";
import { addMoney, ceilMoney, formatMoney, gte, mulMoney, subMoney, toMoneyString, ZERO_MONEY } from "./money";

describe("money", () => {
    it("serialises to the storage scale without exponent notation", () => {
        expect(toMoneyString("0.3")).toBe("0.300000");
        expect(toMoneyString(0.3)).toBe("0.300000");
        expect(toMoneyString("1e-6")).toBe("0.000001");
        expect(ZERO_MONEY).toBe("0.000000");
    });

    it("keeps precision that a float would lose", () => {
        // 0.1 + 0.2 !== 0.3 in binary floating point; the decimal path must not drift.
        expect(toMoneyString(addMoney("0.1", "0.2"))).toBe("0.300000");
        expect(toMoneyString(mulMoney("0.085", 3))).toBe("0.255000");
        expect(toMoneyString(subMoney("0.3", "0.1"))).toBe("0.200000");
    });

    it("rounds up when converting to the storage scale so we never under-charge", () => {
        expect(toMoneyString(ceilMoney("0.0000004"))).toBe("0.000001");
        expect(toMoneyString(ceilMoney("0.30"))).toBe("0.300000");
    });

    it("compares without float error", () => {
        expect(gte("0.300000", "0.3")).toBe(true);
        expect(gte("0.299999", "0.3")).toBe(false);
        expect(gte(mulMoney("0.1", 3), "0.3")).toBe(true);
    });

    it("formats for display with two decimals", () => {
        expect(formatMoney("10")).toBe("10.00");
        expect(formatMoney("0.085")).toBe("0.09");
        expect(formatMoney("1.005")).toBe("1.01");
    });
});
