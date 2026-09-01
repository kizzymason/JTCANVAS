import { apiDelete, apiGet, apiPatch, apiPost, idempotencyHeaders, newIdempotencyKey, type Paginated } from "./client";

export type UserRole = "user" | "admin";

export type WalletSnapshot = {
    balance: string;
    frozen: string;
    totalRecharged: string;
    totalSpent: string;
};

export type CurrentUser = {
    id: string;
    username: string;
    role: UserRole;
    status: "active" | "disabled";
    displayName: string;
    preferences: Record<string, unknown>;
    wallet: WalletSnapshot;
    createdAt: string;
};

export type SiteInfo = {
    siteName: string;
    registrationEnabled: boolean;
    rechargeNotice: string;
    imageGenerationEnabled: boolean;
    videoGenerationEnabled: boolean;
    agentEnabled: boolean;
};

export type LedgerEntry = {
    id: string;
    type: "recharge" | "redeem" | "freeze" | "settle" | "refund" | "admin_adjust";
    amount: string;
    balanceAfter: string;
    note: string;
    createdAt: string;
};

export type OrderRecord = {
    id: string;
    orderNo: string;
    amount: string;
    status: string;
    paymentProvider: string;
    paidAt: string | null;
    createdAt: string;
};

export function fetchBootstrap() {
    return apiGet<{ site: SiteInfo; user: CurrentUser | null }>("/auth/bootstrap");
}

export function register(body: { username: string; password: string }) {
    return apiPost<{ user: CurrentUser }>("/auth/register", body);
}

export function login(body: { username: string; password: string }) {
    return apiPost<{ user: CurrentUser }>("/auth/login", body);
}

export function logout() {
    return apiPost<{ ok: boolean }>("/auth/logout");
}

export function fetchMe() {
    return apiGet<CurrentUser>("/auth/me");
}

export function changePassword(body: { currentPassword: string; newPassword: string }) {
    return apiPost<{ ok: boolean }>("/auth/password", body);
}

export function fetchWallet() {
    return apiGet<WalletSnapshot>("/wallet");
}

export function fetchLedger(params: { page: number; pageSize: number; type?: LedgerEntry["type"] }) {
    return apiGet<Paginated<LedgerEntry>>("/wallet/ledger", { params });
}

export function fetchOrders(params: { page: number; pageSize: number }) {
    return apiGet<Paginated<OrderRecord>>("/wallet/orders", { params });
}

/** Card redemption moves money, so it carries an idempotency key generated per attempt. */
export function redeemCard(code: string, idempotencyKey = newIdempotencyKey()) {
    return apiPost<{ amount: string; balance: string; orderNo: string }>("/wallet/redeem", { code }, idempotencyHeaders(idempotencyKey));
}

export function updatePreferences(preferences: Record<string, unknown>) {
    return apiPatch<{ ok: boolean }>("/auth/preferences", { preferences });
}

export { apiDelete };
