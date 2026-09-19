import { apiDelete, apiGet, apiPatch, apiPost, type Paginated } from "./client";

export type CardCommissionMode = "rate" | "fixed";
export type CardCommissionState = "none" | "pending" | "accrued" | "reversed";

export type AdminCardMerchant = {
    id: string;
    name: string;
    secretPrefix: string;
    secretTail: string;
    commissionMode: CardCommissionMode;
    commissionRate: string;
    commissionBalance: string;
    holdDays: number;
    dailySalesLimit: string;
    productScope: string[];
    allowedIps: string[];
    returnUrls: string[];
    checkoutLabel: string;
    preferredChannelId: string | null;
    payoutAccount: string;
    webhookUrl: string;
    hasWebhookSecret: boolean;
    enabled: boolean;
    suspendedReason: string;
    lastUsedAt: string | null;
    createdAt: string;
    updatedAt: string;
    prices: Array<{ productId: string; unitPrice: string }>;
    grossSales: string;
    paidOrders: number;
    cardsSold: number;
    commissionTotal: string;
    refundedOrders: number;
};

export type UpsertCardMerchantInput = {
    name: string;
    commissionMode?: CardCommissionMode;
    commissionRate?: string;
    holdDays?: number;
    dailySalesLimit?: string;
    productScope?: string[];
    allowedIps?: string[];
    returnUrls?: string[];
    checkoutLabel?: string;
    preferredChannelId?: string;
    payoutAccount?: string;
    webhookUrl?: string;
    webhookSecret?: string;
    enabled?: boolean;
};

export type CardMerchantSummary = {
    grossSales: string;
    paidOrders: number;
    commissionTotal: string;
    commissionBalance: string;
    commissionHeld: string;
    commissionPayable: string;
    paidOut: string;
};

export type CardMerchantLedgerRow = {
    id: string;
    type: "commission" | "payout" | "reversal" | "adjust";
    amount: string;
    balanceAfter: string;
    note: string;
    createdAt: string;
};

export type AdminChannelOrder = {
    id: string;
    orderNo: string;
    merchantId: string;
    merchantName: string;
    merchantReference: string;
    email: string;
    productName: string;
    quantity: number;
    amount: string;
    status: "pending" | "paid" | "failed" | "cancelled";
    commissionAmount: string;
    commissionState: CardCommissionState;
    commissionPayableAt: string | null;
    deliveredCount: number;
    paidAt: string | null;
    createdAt: string;
};

export type CardMerchantPayout = {
    id: string;
    merchantId: string;
    merchantName: string;
    amount: string;
    method: string;
    reference: string;
    note: string;
    createdAt: string;
};

export type CardChannelRanking = {
    merchantId: string;
    merchantName: string;
    orders: number;
    cards: number;
    grossSales: string;
    commission: string;
};

export const cardDistApi = {
    merchants: () => apiGet<{ items: AdminCardMerchant[] }>("/admin/card-dist/merchants"),
    /** The plaintext secret is returned exactly once, here. */
    createMerchant: (body: UpsertCardMerchantInput) => apiPost<{ merchant: AdminCardMerchant; secret: string }>("/admin/card-dist/merchants", body),
    updateMerchant: (id: string, body: UpsertCardMerchantInput) => apiPatch<{ merchant: AdminCardMerchant }>(`/admin/card-dist/merchants/${id}`, body),
    reissueSecret: (id: string) => apiPost<{ merchant: AdminCardMerchant; secret: string }>(`/admin/card-dist/merchants/${id}/reissue`),
    removeMerchant: (id: string) => apiDelete<{ id: string }>(`/admin/card-dist/merchants/${id}`),
    replacePrices: (id: string, prices: Array<{ productId: string; unitPrice: string }>) =>
        apiPost<{ merchantId: string; count: number }>(`/admin/card-dist/merchants/${id}/prices`, { prices }),
    summary: (id: string) => apiGet<CardMerchantSummary>(`/admin/card-dist/merchants/${id}/summary`),
    payout: (id: string, body: { amount: string; method: string; reference?: string; note?: string }) =>
        apiPost<{ payoutId: string; commissionBalance: string }>(`/admin/card-dist/merchants/${id}/payouts`, body),
    adjust: (id: string, body: { amount: string; note: string }) => apiPost<{ commissionBalance: string }>(`/admin/card-dist/merchants/${id}/adjust`, body),
    ledger: (id: string, params: { page: number; pageSize: number }) => apiGet<Paginated<CardMerchantLedgerRow>>(`/admin/card-dist/merchants/${id}/ledger`, { params }),
    reverse: (body: { orderNo: string; note: string }) => apiPost<{ reversed: string; shortfall: string }>("/admin/card-dist/commission/reverse", body),
    leaderboard: (days?: number) => apiGet<{ items: CardChannelRanking[]; since: string }>("/admin/card-dist/leaderboard", { params: days ? { days } : undefined }),
    orders: (params: { page: number; pageSize: number; merchantId?: string }) => apiGet<Paginated<AdminChannelOrder>>("/admin/card-dist/orders", { params }),
    orderCodes: (id: string) => apiGet<{ items: Array<{ code: string }> }>(`/admin/card-dist/orders/${id}/codes`),
    payouts: (params: { page: number; pageSize: number; merchantId?: string }) => apiGet<Paginated<CardMerchantPayout>>("/admin/card-dist/payouts", { params }),
};
