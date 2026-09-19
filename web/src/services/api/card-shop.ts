import { apiGet, apiPost, type Paginated } from "./client";

export type CardPaymentMethod = "alipay" | "wxpay";

export type CardProduct = {
    id: string;
    name: string;
    description: string;
    faceValue: string;
    salePrice: string;
    perOrderLimit: number;
    stock: number;
};

export type CardShopCatalog = {
    items: CardProduct[];
    methods: Array<{ method: CardPaymentMethod; label: string; channelId: string }>;
    available: boolean;
};

export type CardOrderStatus = "pending" | "paid" | "failed" | "cancelled";

export type CardOrder = {
    orderNo: string;
    email: string;
    productName: string;
    faceValue: string;
    unitPrice: string;
    quantity: number;
    amount: string;
    status: CardOrderStatus;
    method: string;
    paidAt: string | null;
    createdAt: string;
    deliveredCount: number;
    /** Only populated once the order is paid and the caller proved ownership. */
    codes: string[];
    /** Paid, but the access token was missing or wrong. */
    codesLocked?: boolean;
};

export type CardCheckout = {
    orderNo: string;
    /** Returned once at checkout; required to read the codes. Kept locally, never sent anywhere else. */
    accessToken: string;
    amount: string;
    quantity: number;
    method: CardPaymentMethod;
    payUrl: string;
    qrcode: string;
    img: string;
};

/**
 * The storefront is unauthenticated. Two things can unlock an order's codes: the access token minted
 * at checkout, or proving control of the e-mail it was bought with.
 */
export const cardShopApi = {
    catalog: () => apiGet<CardShopCatalog>("/card-shop/catalog"),
    createOrder: (body: { productId: string; quantity: number; email: string; method: CardPaymentMethod; channelId?: string }) => apiPost<CardCheckout>("/card-shop/orders", body),
    order: (orderNo: string, token?: string) => apiGet<CardOrder>(`/card-shop/orders/${encodeURIComponent(orderNo)}`, token ? { params: { token } } : undefined),
    lookup: (body: { email: string; page: number; pageSize: number }) => apiPost<Paginated<CardOrder>>("/card-shop/orders/lookup", body),
};

/**
 * Access tokens live in localStorage so a refresh, or coming back from the cashier, can still show
 * the codes. Losing them is not fatal: the e-mail look-up gets the buyer back in.
 */
const TOKEN_STORAGE_KEY = "jt.cardShop.tokens";

function readTokens(): Record<string, string> {
    try {
        return JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) || "{}") as Record<string, string>;
    } catch {
        return {};
    }
}

export function rememberOrderToken(orderNo: string, token: string) {
    try {
        const tokens = readTokens();
        tokens[orderNo] = token;
        localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
    } catch {
        // Private browsing or a full quota: the e-mail look-up still works.
    }
}

export function recallOrderToken(orderNo: string) {
    return readTokens()[orderNo];
}
