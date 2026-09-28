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
 * 协议字段与彩虹易支付一致（pid/type/out_trade_no/money/sign MD5），但收款方式不同：
 *  1) `mapi.php` 必须同时带 `notify_url` 与 `return_url`，少一个就回「同步通知不可为空」并拒绝出码；
 *  2) 出码时 `qrcode` 给的是**收款码链接本身**（不是图片地址），要在前端自己画成二维码；
 *  3) 收款码是静态的（每单同一个），用户必须在支付宝里**手动输入金额**，所以金额必须显示清楚、可复制；
 *  4) 应付金额由上游按小数位决定（实测下单 0.02 收银台显示 0.03），`mapi.php` 不返回它，只能从收银台页面取回；
 *     订单金额必须对齐这个数，否则回调金额与订单不符、钱到了也不会入账。
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
            const tradeNo = firstNonEmpty(body.trade_no) || undefined;
            const payable = normalizeGatewayMoney(body.money) || (tradeNo ? await this.consoleAmount(input.gatewayUrl, tradeNo) : "");
            return {
                payUrl: links.payUrl,
                qrcode: links.qrcode,
                img: links.img,
                tradeNo,
                money: payable || undefined,
            };
        } catch (error) {
            this.logger.warn(`mapi.php 不可用，退回页面跳转支付：${errorMessage(error)}`);
            return { payUrl: pageUrl };
        }
    }

    /**
     * 收银台页面上显示的应付金额才是用户真正要付、回调也只认的数，而 `mapi.php` 不返回它
     * （上游按小数位区分并发订单，例如下单 0.02 会显示 0.03）。取不到就返回空串，绝不影响下单。
     */
    private async consoleAmount(gatewayUrl: string, tradeNo: string): Promise<string> {
        try {
            const response = await axios.get(buildConsoleUrl(gatewayUrl, tradeNo), {
                timeout: REQUEST_TIMEOUT_MS,
                validateStatus: () => true,
            });
            if (response.status !== 200 || typeof response.data !== "string") return "";
            const amount = parseConsoleAmount(response.data);
            if (amount) this.logger.log(`收银台应付金额 ${amount}（${tradeNo}）`);
            return amount;
        } catch (error) {
            this.logger.warn(`读取收银台金额失败（不影响下单）：${errorMessage(error)}`);
            return "";
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
        const params = yqpayMapiParams(input);
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

/**
 * mapi.php 的下单参数（未签名）。云启码支付要求 `notify_url`（异步通知）与 `return_url`（同步通知）**都**必须存在：
 * 少了 return_url，上游直接回 `{"code":201,"msg":"同步通知不可为空!"}`，既拿不到 trade_no 也拿不到二维码，
 * 只能退回页面跳转（2026-09-28 在生产上实测踩到：照搬彩虹易支付的 mapi 参数就会中招）。
 */
export function yqpayMapiParams(input: GatewayCheckoutInput): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries({
        pid: input.merchantId,
        type: input.method,
        out_trade_no: input.orderNo,
        notify_url: input.notifyUrl,
        return_url: input.returnUrl,
        name: input.name,
        money: input.money,
        clientip: input.clientIp,
        device: input.device ?? "pc",
        cid: input.cid ?? "",
        param: input.param ?? "",
    })) {
        if (value !== "") out[name] = value;
    }
    return out;
}

/**
 * 从收银台页面抓这一单的应付金额。上游页面里是这样两处（实测）：
 *   `<p class="money" id="price" …> 0.03 <button data-clipboard-text="0.03">复制金额</button>`
 * 优先用复制按钮上的值（最干净），退而求其次用 `#price` 的文本；都抓不到返回空串。
 */
export function parseConsoleAmount(html: string): string {
    const byClipboard = /data-clipboard-text\s*=\s*["']([0-9]+(?:\.[0-9]+)?)["']/i.exec(html);
    const byPrice = /id\s*=\s*["']price["'][^>]*>\s*([0-9]+(?:\.[0-9]+)?)/i.exec(html);
    return normalizeGatewayMoney(byClipboard?.[1] ?? byPrice?.[1] ?? "") || "";
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
