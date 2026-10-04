export const PAYMENT_METHODS = ["alipay", "wxpay"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_DRIVERS = ["epay", "yqpay"] as const;
export type PaymentDriver = (typeof PAYMENT_DRIVERS)[number];

export function isPaymentMethod(value: string): value is PaymentMethod {
    return (PAYMENT_METHODS as readonly string[]).includes(value);
}

export function isPaymentDriver(value: string): value is PaymentDriver {
    return (PAYMENT_DRIVERS as readonly string[]).includes(value);
}

export type GatewayCheckoutInput = {
    gatewayUrl: string;
    merchantId: string;
    secret: string;
    method: PaymentMethod;
    orderNo: string;
    /** Gateway money: two decimal places, never a JS number. */
    money: string;
    name: string;
    notifyUrl: string;
    returnUrl: string;
    clientIp: string;
    cid?: string;
    param?: string;
    device?: string;
};

export type GatewayCheckoutResult = {
    payUrl: string;
    qrcode?: string;
    img?: string;
    tradeNo?: string;
    /** 网关给的原生唤起链接（支付宝客户端 scheme 等），有则前端优先用它唤起 App。 */
    urlscheme?: string;
    /**
     * 网关实际收款金额。码支付类渠道（金额后加小数位区分并发到账）会与请求金额不同，
     * 此时订单金额必须对齐它，否则回调/查单的金额校验会对不上。
     */
    money?: string;
};

export type GatewayOrderQuery = {
    paid: boolean;
    money?: string;
    tradeNo?: string;
    type?: string;
};

/**
 * 网关返回金额只在合法时采用（正数、最多 6 位小数），非法或缺失时回退订单原金额。
 * 采用后统一交给 formatMoney 归一，保证回调比较时两边口径一致。
 */
export function resolvePayableAmount(raw: string | undefined, fallback: string): string {
    const value = (raw ?? "").trim();
    if (!value || !/^\d+(\.\d{1,6})?$/.test(value)) return fallback;
    return Number(value) > 0 ? value : fallback;
}

export abstract class PaymentGateway {
    abstract readonly driver: PaymentDriver;

    abstract createCheckout(input: GatewayCheckoutInput): Promise<GatewayCheckoutResult>;

    abstract queryOrder(input: { gatewayUrl: string; merchantId: string; secret: string; orderNo: string }): Promise<GatewayOrderQuery>;

    abstract queryBalance(input: { gatewayUrl: string; merchantId: string; secret: string }): Promise<string>;

    abstract verifyNotify(params: Record<string, string>, secret: string): boolean;
}
