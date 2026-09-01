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
};

/**
 * Z-Pay / 彩虹易支付. Page pay is `submit.php`; API pay is `mapi.php`; query is `api.php`.
 * Compatible with the rainbow epay protocol so a second 易支付 gateway can reuse this adapter.
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
            return {
                payUrl,
                qrcode: firstNonEmpty(api.qrcode),
                img: firstNonEmpty(api.img),
                tradeNo: firstNonEmpty(api.trade_no),
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
