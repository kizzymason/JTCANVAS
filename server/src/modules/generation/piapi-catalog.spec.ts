import { describe, expect, it } from "vitest";
import { piapiSeedFeatures, piapiSeedPriceRows, PIAPI_SEEDREAM_MODELS, usdToCny } from "./piapi-catalog";

describe("PiAPI catalog prices", () => {
    it("converts published USD list prices to CNY strings at 7.2 without using Number", () => {
        expect(usdToCny("0.052")).toBe("0.374400");
        expect(usdToCny("0.065")).toBe("0.468000");
        expect(usdToCny("0.068")).toBe("0.489600");
        expect(usdToCny("0.136")).toBe("0.979200");
        expect(usdToCny("0.085")).toBe("0.612000");
        expect(usdToCny("0.17")).toBe("1.224000");
        expect(usdToCny("0.003")).toBe("0.021600");
    });

    it("seeds a default spec plus every published size for the default image model", () => {
        const model = PIAPI_SEEDREAM_MODELS.find((item) => item.name === "seedream-5-pro-less-restriction")!;
        const rows = piapiSeedPriceRows(model);
        expect(rows).toEqual([
            { spec: null, unitPrice: "0.612000", extraReferencePrice: "0.021600" },
            { spec: "1K", unitPrice: "0.612000", extraReferencePrice: "0.021600" },
            { spec: "2K", unitPrice: "1.224000", extraReferencePrice: "0.021600" },
        ]);
    });

    it("seeds Pro as 1K/2K without batch or transparency, and Lite as 2K/4K", () => {
        const pro = piapiSeedFeatures(PIAPI_SEEDREAM_MODELS.find((item) => item.name === "seedream-5-pro-less-restriction")!);
        expect(pro.resolutions).toEqual(["1K", "2K"]);
        expect(pro.maxCount).toBe(1);
        expect(pro.supportsTransparent).toBe(false);

        const lite = piapiSeedFeatures(PIAPI_SEEDREAM_MODELS.find((item) => item.name === "seedream-5-lite")!);
        expect(lite.resolutions).toEqual(["2K", "4K"]);
        expect(lite.maxCount).toBe(1);
    });
});
