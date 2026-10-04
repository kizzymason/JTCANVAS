import { describe, expect, it } from "vitest";
import { isQrImage, qrImageDataUrl, qrImageFor } from "./qr-image";

const WAP_PAGE = "https://www.chpay.cc/pay/submitwap/2026100421522688482/";

describe("二维码内容渲染成图片", () => {
    it("把支付页链接渲染成可直接放进 <img src> 的 GIF data URL", () => {
        const dataUrl = qrImageDataUrl(WAP_PAGE);
        expect(dataUrl.startsWith("data:image/gif;base64,")).toBe(true);
        // 结构上真的是一张 GIF（下游 <img src> 能显示的最低要求；库输出 GIF87a/GIF89a 都合法）
        const bytes = Buffer.from(dataUrl.split(",")[1]!, "base64");
        expect(["GIF87a", "GIF89a"]).toContain(bytes.subarray(0, 6).toString("ascii"));
        expect(bytes.length).toBeGreaterThan(200);
    });

    it("内容为空或纯空白时返回空串，不产出破图", () => {
        expect(qrImageDataUrl("")).toBe("");
        expect(qrImageDataUrl("   ")).toBe("");
    });

    it("同一内容渲染结果稳定（下游可缓存/比对）", () => {
        expect(qrImageDataUrl(WAP_PAGE)).toBe(qrImageDataUrl(WAP_PAGE));
    });
});

describe("判断 qrcode 本身是不是图片", () => {
    it("data URL 与带图片后缀的地址算图片", () => {
        expect(isQrImage("data:image/png;base64,AAAA")).toBe(true);
        expect(isQrImage("https://cdn.example.com/qr.png")).toBe(true);
        expect(isQrImage("https://cdn.example.com/qr.png?v=2")).toBe(true);
        expect(isQrImage("https://cdn.example.com/qr.svg#x")).toBe(true);
    });

    it("二维码内容（支付页链接、收款码链接）不算图片", () => {
        expect(isQrImage(WAP_PAGE)).toBe(false);
        expect(isQrImage("https://qr.alipay.com/fkx19532on8p5hvmgb614b0")).toBe(false);
        expect(isQrImage("")).toBe(false);
    });
});

describe("下单响应里的 img", () => {
    it("网关已给图片时原样沿用，不重复渲染", () => {
        expect(qrImageFor(WAP_PAGE, "https://cdn.example.com/qr.png")).toBe("https://cdn.example.com/qr.png");
    });

    it("只给二维码内容（链接）时补一张图片，qrcode 字段保持不变", () => {
        const img = qrImageFor(WAP_PAGE);
        expect(img.startsWith("data:image/gif;base64,")).toBe(true);
    });

    it("qrcode 本身就是图片地址时不再补图（前台可直接当 <img>）", () => {
        expect(qrImageFor("https://cdn.example.com/qr.png")).toBe("");
    });

    it("两边都没有时返回空串", () => {
        expect(qrImageFor("", "")).toBe("");
        expect(qrImageFor(undefined, undefined)).toBe("");
    });
});
