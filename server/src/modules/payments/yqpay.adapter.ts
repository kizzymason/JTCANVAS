import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { badRequest } from "../../common/errors";
import { epaySign, epayVerify } from "./epay.sign";
import { PaymentGateway, type GatewayCheckoutInput, type GatewayCheckoutResult, type GatewayOrderQuery } from "./payment-gateway";

const REQUEST_TIMEOUT_MS = 15_000;

/** 云启码支付 mapi.php 的返回体。`money` 是网关实际收款金额（码支付会加小数位以保证到账可区分）。 */
export type YqpayCheckoutBody = {
    code?: number | string;
    msg?: string;
    money?: string | number;
    type?: string;
    qrcode?: string;
    code_url?: string;
    img?: string;
    payurl?: string;
    payurl2?: string;
    trade_no?: string;
    out_trade_no?: string;
};

export type CheckoutLinks = {
    payUrl: string;
    qrcode: string;
    img: string;
    /** 该渠道没有二维码，只能让用户点开收银台支付。 */
    viaCashier: boolean;
};

/**
 * 云启码支付（支付宝B 这类「码支付」渠道）。
 *
 * 协议字段与彩虹易支付一致（pid/type/out_trade_no/money/sign MD5），但收款方式是码支付：
 * 上游用支付宝开放平台的账单回调监听到账、并给金额加小数位来区分并发订单，所以
 *  1) 下单返回的 `money` 才是用户实际要付的金额，订单金额必须对齐它，否则回调金额校验不过；
 *  2) 通常拿不到二维码，只能引导用户点开收银台支付（`/Pay/console?trade_no=...`）。
 * 单独一个 driver，与 Z-Pay（易支付）互不影响。
 */
@Injectable()
export class YqpayAdapter extends PaymentGateway {
    readonly driver = "yqpay" as const;
    private readonly logger = new Logger(YqpayAdapter.name);

    async createCheckout(input: GatewayCheckoutInput): Promise<GatewayCheckoutResult> {
        const pageUrl = this.buildSubmitUrl(input);
        try {
            const body = await this.mapi(input);
            const links = resolveCheckoutLinks(body, { gatewayUrl: input.gatewayUrl, pageUrl });
            if (links.viaCashier) {
                this.logger.log(`渠道未返回二维码，改用收银台支付：${links.payUrl}`);
            }
            return {
                payUrl: links.payUrl,
                qrcode: links.qrcode,
                img: links.img,
                tradeNo: firstNonEmpty(body.trade_no) || undefined,
                money: normalizeGatewayMoney(body.money),
            };
        } catch (error) {
            this.logger.warn(`mapi.php 不可用，退回页面跳转支付：${errorMessage(error)}`);
            return { payUrl: pageUrl };
        }
    }

    /**
     * 云启码支付没有公开的订单查询接口（`api.php` 返回 404），到账以平台回调为准，
     * 所以这里只做「尽力而为」：查不到就当作未支付，绝不抛错打断前台的轮询。
     */
    async queryOrder(input: { gatewayUrl: string; merchantId: string; secret: string; orderNo: string }): Promise<GatewayOrderQuery> {
        try {
            const response = await axios.get(`${trimSlash(input.gatewayUrl)}/api.php`, {
                params: { act: "order", pid: input.merchantId, key: input.secret, out_trade_no: input.orderNo },
                timeout: REQUEST_TIMEOUT_MS,
                validateStatus: () => true,
            });
            const body = asRecord(response.data);
            if (Number(body.code) !== 1) {
                this.logger.debug(`查询订单未获支持：${String(body.msg || `HTTP ${response.status}`)}`);
                return { paid: false };
            }
            return {
                paid: Number(body.status) === 1,
                money: normalizeGatewayMoney(body.money),
                tradeNo: typeof body.trade_no === "string" ? body.trade_no : undefined,
                type: typeof body.type === "string" ? body.type : undefined,
            };
        } catch (error) {
            this.logger.warn(`查询订单失败（该渠道以回调为准）：${errorMessage(error)}`);
            return { paid: false };
        }
    }

    /** 该平台没有余额查询接口，明确报错而不是返回一个假的 0。 */
    async queryBalance(): Promise<string> {
        throw badRequest("PAYMENT_BALANCE_UNSUPPORTED", "云启码支付不提供余额查询接口");
    }

    /** 通知签名与彩虹易支付一致（MD5），回调校验同一套算法。 */
    verifyNotify(params: Record<string, string>, secret: string) {
        return epayVerify(params, secret);
    }

    private buildSubmitUrl(input: GatewayCheckoutInput) {
        const params: Record<string, string> = {};
        const raw: Record<string, string> = {
            pid: input.merchantId,
            type: input.method,
            out_trade_no: input.orderNo,
            notify_url: input.notifyUrl,
            return_url: input.returnUrl,
            name: input.name,
            money: input.money,
            cid: input.cid ?? "",
            param: input.param ?? "",
        };
        for (const [name, value] of Object.entries(raw)) {
            if (value !== "") params[name] = value;
        }
        params.sign = epaySign(params, input.secret);
        params.sign_type = "MD5";
        return `${trimSlash(input.gatewayUrl)}/submit.php?${new URLSearchParams(params).toString()}`;
    }

    private async mapi(input: GatewayCheckoutInput): Promise<YqpayCheckoutBody> {
        const raw: Record<string, string> = {
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
        };
        const params: Record<string, string> = {};
        for (const [name, value] of Object.entries(raw)) {
            if (value !== "") params[name] = value;
        }
        params.sign = epaySign(params, input.secret);
        params.sign_type = "MD5";
        const response = await axios.post(`${trimSlash(input.gatewayUrl)}/mapi.php`, new URLSearchParams(params).toString(), {
            timeout: REQUEST_TIMEOUT_MS,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            validateStatus: () => true,
        });
        const body = asRecord(response.data) as YqpayCheckoutBody;
        if (Number(body.code) !== 1) {
            throw new Error(String(body.msg || "mapi.php 下单失败"));
        }
        return body;
    }
}

/** 收银台地址：码支付拿不到二维码时，用户点开这个页面完成支付。 */
export function buildConsoleUrl(gatewayUrl: string, tradeNo: string) {
    return `${trimSlash(gatewayUrl)}/Pay/console?trade_no=${encodeURIComponent(tradeNo)}`;
}

/**
 * 决定这次下单是「扫码支付」还是「跳收银台」。
 * 有二维码就用二维码（payUrl 兜底给收银台）；没有二维码但有 trade_no，一律走收银台。
 */
export function resolveCheckoutLinks(body: YqpayCheckoutBody, input: { gatewayUrl: string; pageUrl: string }): CheckoutLinks {
    const tradeNo = firstNonEmpty(body.trade_no);
    const qrcode = firstNonEmpty(body.qrcode);
    const img = firstNonEmpty(body.code_url, body.img);
    const direct = firstNonEmpty(body.payurl, body.payurl2);
    const hasQr = Boolean(qrcode || img);
    const consoleUrl = tradeNo ? buildConsoleUrl(input.gatewayUrl, tradeNo) : "";
    if (hasQr) {
        return { payUrl: direct || consoleUrl || input.pageUrl, qrcode, img, viaCashier: false };
    }
    if (consoleUrl) {
        return { payUrl: direct || consoleUrl, qrcode: "", img: "", viaCashier: true };
    }
    return { payUrl: direct || input.pageUrl, qrcode: "", img: "", viaCashier: false };
}

/** 网关金额可能是 number、字符串或带多余小数位的值；非法值一律丢弃，交给订单原金额兜底。 */
export function normalizeGatewayMoney(raw: unknown): string | undefined {
    const value = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
    if (!value || !/^\d+(\.\d{1,6})?$/.test(value)) return undefined;
    if (Number(value) <= 0) return undefined;
    return value;
}

function trimSlash(url: string) {
    return url.replace(/\/+$/, "");
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
