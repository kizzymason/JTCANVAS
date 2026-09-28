import { describe, expect, it } from "vitest";
import { resolvePayableAmount } from "./payment-gateway";
import { buildConsoleUrl, normalizeGatewayMoney, resolveCheckoutLinks, yqpayMapiParams } from "./yqpay.adapter";

const GATEWAY = "https://ypay.yunqi.ink";
const PAGE = `${GATEWAY}/submit.php?pid=1000&sign=abc`;
const MAPI_INPUT = {
    gatewayUrl: GATEWAY,
    merchantId: "1000",
    secret: "secret",
    method: "alipay" as const,
    orderNo: "IC2026092801",
    money: "20.15",
    name: "余额充值",
    notifyUrl: "https://jingtiang.com/api/payments/epay/notify",
    returnUrl: "https://jingtiang.com/",
    clientIp: "1.2.3.4",
    cid: "448",
};

describe("mapi.php 下单参数", () => {
    it("必须同时带 notify_url 与 return_url：少 return_url 上游会回「同步通知不可为空」并拒绝出码", () => {
        const params = yqpayMapiParams(MAPI_INPUT);
        expect(params.notify_url).toBe(MAPI_INPUT.notifyUrl);
        expect(params.return_url).toBe(MAPI_INPUT.returnUrl);
        expect(params.out_trade_no).toBe(MAPI_INPUT.orderNo);
        expect(params.cid).toBe("448");
        expect(params.pid).toBe("1000");
    });

    it("空值不下发（cid/param 为空时该字段不出现）", () => {
        const params = yqpayMapiParams({ ...MAPI_INPUT, cid: "", param: "" });
        expect("cid" in params).toBe(false);
        expect("param" in params).toBe(false);
    });
});

describe("码支付（支付宝B）收银台路由", () => {
    it("拿不到二维码时必须给出收银台地址，让用户点开支付", () => {
        const links = resolveCheckoutLinks({ code: 1, trade_no: "YQ2026092817251671638", money: "20.15" }, { gatewayUrl: GATEWAY, pageUrl: PAGE });
        expect(links.viaCashier).toBe(true);
        expect(links.payUrl).toBe(`${GATEWAY}/Pay/console?trade_no=YQ2026092817251671638`);
        expect(links.qrcode).toBe("");
        expect(links.img).toBe("");
    });

    it("有二维码时仍走扫码，payUrl 兜底给收银台", () => {
        const links = resolveCheckoutLinks(
            { code: 1, trade_no: "YQ1", qrcode: "https://qr.example/a.png" },
            { gatewayUrl: GATEWAY, pageUrl: PAGE },
        );
        expect(links.viaCashier).toBe(false);
        expect(links.qrcode).toBe("https://qr.example/a.png");
        expect(links.payUrl).toBe(`${GATEWAY}/Pay/console?trade_no=YQ1`);
    });

    it("网关给了跳转地址就用它，code_url 当图片用", () => {
        const links = resolveCheckoutLinks(
            { code: 1, payurl: "https://pay.example/jump", code_url: "https://qr.example/b.png", trade_no: "YQ2" },
            { gatewayUrl: GATEWAY, pageUrl: PAGE },
        );
        expect(links.payUrl).toBe("https://pay.example/jump");
        expect(links.img).toBe("https://qr.example/b.png");
        expect(links.viaCashier).toBe(false);
    });

    it("既没二维码也没 trade_no 时退回页面跳转地址", () => {
        const links = resolveCheckoutLinks({ code: 1 }, { gatewayUrl: GATEWAY, pageUrl: PAGE });
        expect(links.payUrl).toBe(PAGE);
        expect(links.viaCashier).toBe(false);
    });

    it("收银台地址末尾斜杠不会重复", () => {
        expect(buildConsoleUrl("https://ypay.yunqi.ink/", "YQ3")).toBe("https://ypay.yunqi.ink/Pay/console?trade_no=YQ3");
    });
});

describe("网关金额解析", () => {
    it("接受数字和小数字符串（含码支付加的小数位）", () => {
        expect(normalizeGatewayMoney(20.15)).toBe("20.15");
        expect(normalizeGatewayMoney("20.1500")).toBe("20.1500");
        expect(normalizeGatewayMoney(" 88 ")).toBe("88");
    });

    it("非法与零值一律丢弃，交给订单金额兜底", () => {
        expect(normalizeGatewayMoney(0)).toBeUndefined();
        expect(normalizeGatewayMoney("0.00")).toBeUndefined();
        expect(normalizeGatewayMoney("")).toBeUndefined();
        expect(normalizeGatewayMoney(undefined)).toBeUndefined();
        expect(normalizeGatewayMoney("二十")).toBeUndefined();
        expect(normalizeGatewayMoney("-1")).toBeUndefined();
        expect(normalizeGatewayMoney("1.123456789")).toBeUndefined();
    });
});

describe("订单金额对齐", () => {
    it("网关金额合法时以网关为准", () => {
        expect(resolvePayableAmount("20.15", "20.00")).toBe("20.15");
        expect(resolvePayableAmount("20.1500", "20.00")).toBe("20.1500");
    });

    it("网关金额缺失或非法时保留订单原金额", () => {
        expect(resolvePayableAmount(undefined, "20.00")).toBe("20.00");
        expect(resolvePayableAmount("", "20.00")).toBe("20.00");
        expect(resolvePayableAmount("abc", "20.00")).toBe("20.00");
        expect(resolvePayableAmount("0", "20.00")).toBe("20.00");
    });
});
