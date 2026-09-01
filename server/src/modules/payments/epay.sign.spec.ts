import { describe, expect, it } from "vitest";
import { epaySign, epayVerify, flattenQuery } from "./epay.sign";

describe("epaySign", () => {
    const key = "testkey";

    it("signs ASCII-sorted params, skipping sign, sign_type and empty values", () => {
        const params = {
            pid: "2026081614592316",
            type: "alipay",
            out_trade_no: "IC20260101120000ABCD1234",
            notify_url: "https://example.com/api/payments/epay/notify",
            name: "景甜画布余额充值10.00元",
            money: "10.00",
            sign_type: "MD5",
            unused: "",
        };
        const sign = epaySign(params, key);
        expect(sign).toMatch(/^[a-f0-9]{32}$/);
        expect(epayVerify({ ...params, sign }, key)).toBe(true);
        expect(epayVerify({ ...params, sign: "deadbeef" }, key)).toBe(false);
    });

    it("is stable regardless of object key insertion order", () => {
        const a = epaySign({ money: "10.00", name: "sku", pid: "1" }, key);
        const b = epaySign({ pid: "1", name: "sku", money: "10.00" }, key);
        expect(a).toBe(b);
    });

    it("flattens array query values the way Fastify may present them", () => {
        expect(flattenQuery({ out_trade_no: ["IC1"], money: "10.00" })).toEqual({ out_trade_no: "IC1", money: "10.00" });
    });
});
