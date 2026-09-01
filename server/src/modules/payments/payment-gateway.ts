export const PAYMENT_METHODS = ["alipay", "wxpay"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_DRIVERS = ["epay"] as const;
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
};

export type GatewayOrderQuery = {
    paid: boolean;
    money?: string;
    tradeNo?: string;
    type?: string;
};

export abstract class PaymentGateway {
    abstract readonly driver: PaymentDriver;

    abstract createCheckout(input: GatewayCheckoutInput): Promise<GatewayCheckoutResult>;

    abstract queryOrder(input: { gatewayUrl: string; merchantId: string; secret: string; orderNo: string }): Promise<GatewayOrderQuery>;

    abstract queryBalance(input: { gatewayUrl: string; merchantId: string; secret: string }): Promise<string>;

    abstract verifyNotify(params: Record<string, string>, secret: string): boolean;
}
