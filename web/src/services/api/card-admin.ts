import { apiDelete, apiGet, apiPatch, apiPost, type Paginated } from "./client";
import type { CardOrderStatus } from "./card-shop";

export type AdminCardProduct = {
    id: string;
    name: string;
    description: string;
    faceValue: string;
    salePrice: string;
    perOrderLimit: number;
    enabled: boolean;
    sortOrder: number;
    /** Unsold, unused, unexpired cards stocked against this product. */
    stock: number;
    soldCount: number;
    createdAt: string;
    updatedAt: string;
};

export type UpsertCardProductInput = {
    name: string;
    description?: string;
    faceValue: string;
    salePrice: string;
    perOrderLimit?: number;
    enabled?: boolean;
    sortOrder?: number;
};

export type AdminCardOrderTotals = { paidOrders: number; revenue: string; undelivered: number };

export type AdminCardOrder = {
    id: string;
    orderNo: string;
    email: string;
    productName: string;
    faceValue: string;
    unitPrice: string;
    quantity: number;
    amount: string;
    status: CardOrderStatus;
    method: string;
    deliveredCount: number;
    providerTxnId: string;
    clientIp: string;
    paidAt: string | null;
    createdAt: string;
    totals?: AdminCardOrderTotals;
};

export type StockResult = { batchId: string; inserted: number; requested: number; skipped?: number; duplicatedInInput?: number };

export const cardAdminApi = {
    products: () => apiGet<{ items: AdminCardProduct[] }>("/admin/card-shop/products"),
    createProduct: (body: UpsertCardProductInput) => apiPost<{ product: AdminCardProduct }>("/admin/card-shop/products", body),
    updateProduct: (id: string, body: UpsertCardProductInput) => apiPatch<{ product: AdminCardProduct }>(`/admin/card-shop/products/${id}`, body),
    deleteProduct: (id: string) => apiDelete<{ id: string }>(`/admin/card-shop/products/${id}`),
    generate: (id: string, body: { quantity: number; batchName?: string; expiresAt?: string }) => apiPost<StockResult>(`/admin/card-shop/products/${id}/generate`, body),
    import: (id: string, body: { codes: string; batchName?: string; expiresAt?: string }) => apiPost<StockResult>(`/admin/card-shop/products/${id}/import`, body),
    orders: (params: { page: number; pageSize: number; status?: CardOrderStatus; keyword?: string; productId?: string }) => apiGet<Paginated<AdminCardOrder>>("/admin/card-shop/orders", { params }),
    orderCodes: (id: string) => apiGet<{ codes: string[] }>(`/admin/card-shop/orders/${id}/codes`),
};
