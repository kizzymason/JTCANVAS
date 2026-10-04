import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { badRequest } from "../../common/errors";
import { epaySign, epayVerify } from "./epay.sign";
import { PaymentGateway, type GatewayCheckoutInput, type GatewayCheckoutResult, type GatewayOrderQuery } from "./payment-gateway";

const REQUEST_TIMEOUT_MS = 15_000;

type MapiSuccess = {
    code?: number | string;
    msg?: string;
    payurl?: string;
    payurl2?: string;
    qrcode?: string;
    img?: string;
    trade_no?: string;
    urlscheme?: string;
};

/**
 * Z-Pay / 彩虹易支付. Page pay is `submit.php`; API pay is `mapi.php`; query is `api.php`.
 * Compatible with the rainbow epay protocol so a second 易支付 gateway can reuse this adapter.
 *
 * 有的网关（景诺支付 / chpay.cc）`mapi.php` **只回收银台地址**，不给 `qrcode`，二维码内容藏在网关自己的
 * 扫码页里（`<gateway>/pay/qrcode/<trade_no>/` 的 `var code_url`）；这时由这里取回来交给前台自己画成二维码。
 */
@Injectable()
export class EpayAdapter extends PaymentGateway {
    readonly driver = "epay" as const;
    private readonly logger = new Logger(EpayAdapter.name);

    async createCheckout(input: GatewayCheckoutInput): Promise<GatewayCheckoutResult> {
        const submitUrl = this.buildSubmitUrl(input);
        try {
            const api = await this.mapi(input);
            const payUrl = firstNonEmpty(api.payurl, api.payurl2, submitUrl);
            const tradeNo = firstNonEmpty(api.trade_no);
            const qrcode = firstNonEmpty(api.qrcode);
            const urlscheme = firstNonEmpty(api.urlscheme);
            // 响应里没有二维码内容时，去网关扫码页把它取回来（取不到就当没有，绝不影响下单）。
            const scan = qrcode || !tradeNo ? null : await this.scanQrcode(input.gatewayUrl, tradeNo);
            return {
                payUrl,
                qrcode: qrcode || scan?.codeUrl || "",
                img: firstNonEmpty(api.img, scan?.img),
                tradeNo,
                urlscheme: urlscheme || scan?.urlScheme || "",
            };
        } catch (error) {
            this.logger.warn(`mapi.php unavailable, falling back to submit.php: ${errorMessage(error)}`);
            return { payUrl: submitUrl };
        }
    }

    async queryOrder(input: { gatewayUrl: string; merchantId: string; secret: string; orderNo: string }): Promise<GatewayOrderQuery> {
        const url = `${trimSlash(input.gatewayUrl)}/api.php`;
        const response = await axios.get(url, {
            params: { act: "order", pid: input.merchantId, key: input.secret, out_trade_no: input.orderNo },
            timeout: REQUEST_TIMEOUT_MS,
            validateStatus: () => true,
        });
        const body = asRecord(response.data);
        if (Number(body.code) !== 1) {
            throw badRequest("PAYMENT_QUERY_FAILED", String(body.msg || "查询支付订单失败"));
        }
        return {
            paid: Number(body.status) === 1,
            money: typeof body.money === "string" || typeof body.money === "number" ? String(body.money) : undefined,
            tradeNo: typeof body.trade_no === "string" ? body.trade_no : undefined,
            type: typeof body.type === "string" ? body.type : undefined,
        };
    }

    async queryBalance(input: { gatewayUrl: string; merchantId: string; secret: string }): Promise<string> {
        const url = `${trimSlash(input.gatewayUrl)}/api.php`;
        const response = await axios.get(url, {
            params: { act: "balance", pid: input.merchantId, key: input.secret },
            timeout: REQUEST_TIMEOUT_MS,
            validateStatus: () => true,
        });
        const body = asRecord(response.data);
        if (Number(body.code) !== 1) {
            throw badRequest("PAYMENT_BALANCE_FAILED", String(body.msg || "查询支付渠道余额失败"));
        }
        return String(body.balance ?? "0");
    }

    verifyNotify(params: Record<string, string>, secret: string) {
        return epayVerify(params, secret);
    }

    private buildSubmitUrl(input: GatewayCheckoutInput) {
        const params = this.submitParams(input);
        params.sign = epaySign(params, input.secret);
        params.sign_type = "MD5";
        const search = new URLSearchParams(params);
        return `${trimSlash(input.gatewayUrl)}/submit.php?${search.toString()}`;
    }

    private async mapi(input: GatewayCheckoutInput): Promise<MapiSuccess> {
        const params = this.mapiParams(input);
        params.sign = epaySign(params, input.secret);
        params.sign_type = "MD5";
        const form = new URLSearchParams(params);
        const response = await axios.post(`${trimSlash(input.gatewayUrl)}/mapi.php`, form.toString(), {
            timeout: REQUEST_TIMEOUT_MS,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            validateStatus: () => true,
        });
        const body = asRecord(response.data) as MapiSuccess;
        if (Number(body.code) !== 1) {
            throw new Error(String(body.msg || "mapi.php 下单失败"));
        }
        return body;
    }

    /**
     * 网关自己的扫码页里带着二维码内容（`<gateway>/pay/qrcode/<trade_no>/`）：
     *   `var code_url = 'https://…/pay/submitwap/<trade_no>/'`（要编进二维码的链接，扫开就是这一单的支付页）
     *   `var url_scheme = 'alipays://platformapi/startapp?appId=20000067&url=…'`（手机端直接唤起支付宝）
     * 抓不到就返回 null，前台退回「打开支付页面」，绝不让下单失败。
     */
    private async scanQrcode(gatewayUrl: string, tradeNo: string): Promise<ScanQrcode | null> {
        try {
            const response = await axios.get(buildScanQrcodeUrl(gatewayUrl, tradeNo), {
                timeout: REQUEST_TIMEOUT_MS,
                validateStatus: () => true,
            });
            if (response.status !== 200 || typeof response.data !== "string") return null;
            const scan = parseScanQrcode(response.data);
            if (!scan.codeUrl && !scan.img) return null;
            this.logger.log(`网关未返回 qrcode，已从扫码页取回二维码内容（${tradeNo}）`);
            return scan;
        } catch (error) {
            this.logger.warn(`读取网关扫码页失败（不影响下单）：${errorMessage(error)}`);
            return null;
        }
    }

    private submitParams(input: GatewayCheckoutInput): Record<string, string> {
        return omitEmpty({
            pid: input.merchantId,
            type: input.method,
            out_trade_no: input.orderNo,
            notify_url: input.notifyUrl,
            return_url: input.returnUrl,
            name: input.name,
            money: input.money,
            cid: input.cid ?? "",
            param: input.param ?? "",
        });
    }

    private mapiParams(input: GatewayCheckoutInput): Record<string, string> {
        return omitEmpty({
            pid: input.merchantId,
            type: input.method,
            out_trade_no: input.orderNo,
            notify_url: input.notifyUrl,
            name: input.name,
            money: input.money,
            clientip: input.clientIp,
            device: input.device ?? "pc",
            cid: input.cid ?? "",
            param: input.param ?? "",
        });
    }
}

function trimSlash(url: string) {
    return url.replace(/\/+$/, "");
}

/** 网关扫码页里能取到的东西：要编进二维码的内容、唤起客户端的 scheme、以及码本身是图片的情况。 */
export type ScanQrcode = {
    codeUrl: string;
    urlScheme: string;
    img: string;
};

/** 网关扫码页地址：下单响应里没有 qrcode 时，去这里把二维码内容取回来。 */
export function buildScanQrcodeUrl(gatewayUrl: string, tradeNo: string) {
    return `${trimSlash(gatewayUrl)}/pay/qrcode/${encodeURIComponent(tradeNo)}/`;
}

/**
 * 解析网关扫码页里的二维码内容（实测 chpay.cc / 景诺支付）：
 *   `var code_url = '…'`    要编进二维码的内容，扫开就是这一单的支付页
 *   `var url_scheme = 'alipays://…&url=' + encodeURIComponent(code_url)`  手机端唤起支付宝客户端
 * `code_url` 也可能是 `data:image/...`（网关直接给图片），这时按图片返回。
 */
export function parseScanQrcode(html: string): ScanQrcode {
    const codeUrl = /var\s+code_url\s*=\s*['"]([^'"]+)['"]/i.exec(html)?.[1]?.trim() ?? "";
    const scheme = /var\s+url_scheme\s*=\s*['"]([^'"]*)['"]\s*(\+\s*encodeURIComponent\s*\(\s*code_url\s*\))?/i.exec(html);
    let urlScheme = scheme?.[1]?.trim() ?? "";
    // 网关把地址拼在 scheme 后面（`…&url=` + encodeURIComponent(code_url)），这里要补回去。
    if (urlScheme && scheme?.[2] && codeUrl) urlScheme += encodeURIComponent(codeUrl);
    if (/^data:image\//i.test(codeUrl)) return { codeUrl: "", urlScheme, img: codeUrl };
    return { codeUrl, urlScheme, img: "" };
}

function omitEmpty(params: Record<string, string>) {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(params)) {
        if (value !== "") out[name] = value;
    }
    return out;
}

function firstNonEmpty(...values: Array<string | undefined>) {
    return values.find((value) => Boolean(value && value.trim())) ?? "";
}

function asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value === "string") {
        try {
            const parsed: unknown = JSON.parse(value);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
        } catch {
            return {};
        }
    }
    return {};
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "unknown error";
}
