import { describe, expect, it, vi, beforeEach } from "vitest";
import axios from "axios";
import {
    EpayAdapter,
    buildScanQrcodeUrl,
    parseScanQrcode,
} from "./epay.adapter";

vi.mock("axios");

const GATEWAY = "https://www.chpay.cc";
const WAP_PAGE = `${GATEWAY}/pay/submitwap/2026100421241579980/`;

/**
 * 实测页面片段（chpay.cc / 景诺支付 /pay/qrcode/<trade_no>/）：
 * 二维码内容藏在 `var code_url` 里，唤起链接是 `var url_scheme` 拼上 code_url 得到的。
 */
const REAL_SCAN_PAGE = `<script>
\tvar code_url = '${WAP_PAGE}';
    var code_type = code_url.indexOf('data:image/')>-1?1:0;
    if(code_type == 0){
        var url_scheme = 'alipays://platformapi/startapp?appId=20000067&url=' + encodeURIComponent(code_url);
        $('#qrcode').qrcode({ text: code_url, width: 230, height: 230, typeNumber: -1 });
    }else{
        $('#qrcode').html('<img src="'+code_url+'"/>');
    }
</script>`;

const INPUT = {
    gatewayUrl: GATEWAY,
    merchantId: "1000",
    secret: "secret",
    method: "alipay" as const,
    orderNo: "IC2026100401",
    money: "20.00",
    name: "余额充值",
    notifyUrl: "https://jingtiang.com/api/payments/epay/notify",
    returnUrl: "https://jingtiang.com/",
    clientIp: "1.2.3.4",
};

const postMock = vi.mocked(axios.post);
const getMock = vi.mocked(axios.get);

describe("网关扫码页地址", () => {
    it("拼出 /pay/qrcode/<trade_no>/，网关尾斜杠不会拼重复", () => {
        expect(buildScanQrcodeUrl("https://www.chpay.cc", "T1")).toBe(
            "https://www.chpay.cc/pay/qrcode/T1/",
        );
        expect(buildScanQrcodeUrl("https://www.chpay.cc/", "T1")).toBe(
            "https://www.chpay.cc/pay/qrcode/T1/",
        );
    });

    it("订单号做 URL 编码", () => {
        expect(buildScanQrcodeUrl(GATEWAY, "a/b")).toBe(
            `${GATEWAY}/pay/qrcode/a%2Fb/`,
        );
    });
});

describe("网关扫码页解析", () => {
    it("取回二维码内容，并把 scheme 里拼接的支付页地址补回去", () => {
        const scan = parseScanQrcode(REAL_SCAN_PAGE);
        expect(scan.codeUrl).toBe(WAP_PAGE);
        expect(scan.img).toBe("");
        expect(scan.urlScheme).toBe(
            `alipays://platformapi/startapp?appId=20000067&url=${encodeURIComponent(WAP_PAGE)}`,
        );
    });

    it("码本身是图片（data:image）时按图片返回，不当二维码内容", () => {
        const scan = parseScanQrcode(
            `<script>var code_url = 'data:image/png;base64,AAAA';</script>`,
        );
        expect(scan.codeUrl).toBe("");
        expect(scan.img).toBe("data:image/png;base64,AAAA");
    });

    it("页面里没有这些变量时全部为空，不抛错", () => {
        expect(parseScanQrcode("<html><body>404</body></html>")).toEqual({
            codeUrl: "",
            urlScheme: "",
            img: "",
        });
    });
});

describe("下单：响应没有 qrcode 时补二维码", () => {
    beforeEach(() => {
        postMock.mockReset();
        getMock.mockReset();
    });

    it("网关只给收银台 payurl（景诺支付实测）时，去扫码页取回二维码与唤起链接", async () => {
        postMock.mockResolvedValue({
            data: {
                code: 1,
                trade_no: "2026100421241579980",
                payurl: `${GATEWAY}/pay/submit/2026100421241579980/`,
            },
        } as never);
        getMock.mockResolvedValue({
            status: 200,
            data: REAL_SCAN_PAGE,
        } as never);

        const result = await new EpayAdapter().createCheckout(INPUT);

        expect(getMock).toHaveBeenCalledWith(
            buildScanQrcodeUrl(GATEWAY, "2026100421241579980"),
            expect.anything(),
        );
        expect(result.qrcode).toBe(WAP_PAGE);
        expect(result.urlscheme).toContain("alipays://platformapi/startapp");
        expect(result.payUrl).toBe(
            `${GATEWAY}/pay/submit/2026100421241579980/`,
        );
    });

    it("响应里已经带 qrcode（Z-Pay 原生出码）时不再多打一次网关", async () => {
        postMock.mockResolvedValue({
            data: {
                code: 1,
                trade_no: "T9",
                qrcode: "https://qr.alipay.com/abc",
                payurl: "https://p",
            },
        } as never);

        const result = await new EpayAdapter().createCheckout(INPUT);

        expect(getMock).not.toHaveBeenCalled();
        expect(result.qrcode).toBe("https://qr.alipay.com/abc");
    });

    it("扫码页抓不到时不影响下单，前台退回「打开支付页面」", async () => {
        postMock.mockResolvedValue({
            data: { code: 1, trade_no: "T9", payurl: "https://p" },
        } as never);
        getMock.mockRejectedValue(new Error("timeout"));

        const result = await new EpayAdapter().createCheckout(INPUT);

        expect(result.qrcode).toBe("");
        expect(result.payUrl).toBe("https://p");
    });

    it("mapi.php 不可用时仍退回 submit.php 页面支付", async () => {
        postMock.mockResolvedValue({
            data: { code: 0, msg: "签名错误" },
        } as never);

        const result = await new EpayAdapter().createCheckout(INPUT);

        expect(result.payUrl).toContain("/submit.php?");
        expect(result.qrcode).toBeUndefined();
    });
});
