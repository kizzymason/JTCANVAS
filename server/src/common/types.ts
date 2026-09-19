export type UserRole = "user" | "admin" | "reseller";

export type AuthUser = {
    id: string;
    username: string;
    role: UserRole;
    sessionId: string;
    /** Set by ApiKeyGuard on open-platform requests; absent for browser sessions. */
    apiKeyId?: string;
};

/** Fastify request augmented by AuthGuard. */
export type RequestWithUser = {
    user?: AuthUser;
    ip?: string;
    headers: Record<string, string | string[] | undefined>;
    method: string;
    url: string;
    body?: unknown;
    cookies?: Record<string, string | undefined>;
};

export type Paginated<T> = {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
};
