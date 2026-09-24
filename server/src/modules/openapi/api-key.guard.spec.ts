import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { ApiKeyService, ResolvedApiKey } from "./api-key.service";
import { ApiKeyGuard, bearerToken, clientIp, type RequestWithApiCaller } from "./api-key.guard";
import type { OpenAiApiError, OpenAiErrorBody } from "./openai-errors";

function resolved(partial: Partial<ResolvedApiKey> = {}): ResolvedApiKey {
    return {
        id: "key-1",
        userId: "user-1",
        status: "active",
        quotaLimit: null,
        quotaUsed: "0.000000",
        rpmLimit: 0,
        concurrencyLimit: 0,
        modelScope: [],
        allowedIps: [],
        expiresAt: null,
        resellerStatus: "approved",
        multiplierOverride: null,
        tierMultiplier: "0.000000",
        ...partial,
    };
}

function guardFor(key: ResolvedApiKey | null, options: { openPlatformEnabled?: boolean; userStatus?: string; role?: string } = {}) {
    const keys = { resolve: vi.fn(async () => key) } as unknown as ApiKeyService;
    const settings = { getSite: vi.fn(async () => ({ openPlatformEnabled: options.openPlatformEnabled ?? true })) };
    // Only the account lookup hits the database, so the query builder is stubbed down to that row.
    const row = { status: options.userStatus ?? "active", username: "downstream", role: options.role ?? "reseller" };
    const db = {
        select: () => ({ from: () => ({ where: () => ({ limit: async () => (options.userStatus === "missing" ? [] : [row]) }) }) }),
    };
    return new ApiKeyGuard(db as never, keys, settings as never);
}

function contextFor(request: RequestWithApiCaller) {
    return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function request(headers: Record<string, string | undefined> = { authorization: "Bearer sk-jt-secret" }, ip = "203.0.113.10"): RequestWithApiCaller {
    return { headers, ip };
}

async function envelopeOf(run: Promise<unknown>) {
    try {
        await run;
    } catch (error) {
        return ((error as OpenAiApiError).getResponse() as OpenAiErrorBody).error;
    }
    throw new Error("expected the guard to reject");
}

describe("ApiKeyGuard", () => {
    it("attaches the caller and the resolved coefficient on a good key", async () => {
        const guard = guardFor(resolved({ tierMultiplier: "0.200000" }));
        const req = request();
        await expect(guard.canActivate(contextFor(req))).resolves.toBe(true);
        expect(req.apiCaller).toMatchObject({ userId: "user-1", username: "downstream", multiplier: "1.200000" });
        // Mirrored so the shared idempotency and audit interceptors keep working.
        expect(req.user).toMatchObject({ id: "user-1", sessionId: "apikey:key-1", apiKeyId: "key-1" });
    });

    it("prefers an exclusive override over the tier coefficient", async () => {
        const guard = guardFor(resolved({ tierMultiplier: "0.200000", multiplierOverride: "-0.100000" }));
        const req = request();
        await guard.canActivate(contextFor(req));
        expect(req.apiCaller?.multiplier).toBe("0.900000");
    });

    it("rejects a missing Authorization header with the OpenAI missing-key code", async () => {
        const guard = guardFor(resolved());
        expect(await envelopeOf(guard.canActivate(contextFor(request({}))))).toMatchObject({ type: "invalid_api_key", code: "missing_api_key" });
    });

    it("rejects an unknown key", async () => {
        const guard = guardFor(null);
        expect(await envelopeOf(guard.canActivate(contextFor(request())))).toMatchObject({ type: "invalid_api_key", code: "invalid_api_key" });
    });

    it("rejects a disabled key", async () => {
        const guard = guardFor(resolved({ status: "disabled" }));
        expect(await envelopeOf(guard.canActivate(contextFor(request())))).toMatchObject({ code: "api_key_disabled" });
    });

    it("rejects an expired key", async () => {
        const guard = guardFor(resolved({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
        expect(await envelopeOf(guard.canActivate(contextFor(request())))).toMatchObject({ code: "api_key_expired" });
    });

    it("accepts a key whose expiry is still in the future", async () => {
        const guard = guardFor(resolved({ expiresAt: new Date(Date.now() + 60_000).toISOString() }));
        await expect(guard.canActivate(contextFor(request()))).resolves.toBe(true);
    });

    it("enforces the IP allowlist against the forwarded address", async () => {
        const guard = guardFor(resolved({ allowedIps: ["198.51.100.7"] }));
        expect(await envelopeOf(guard.canActivate(contextFor(request({ authorization: "Bearer sk-jt-secret", "x-forwarded-for": "203.0.113.10, 10.0.0.1" }))))).toMatchObject({
            code: "ip_restricted",
        });

        const allowed = request({ authorization: "Bearer sk-jt-secret", "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
        await expect(guard.canActivate(contextFor(allowed))).resolves.toBe(true);
    });

    it("permits basic accounts and keeps access during or after review", async () => {
        for (const status of ["approved", "pending", "rejected", null]) {
            const guard = guardFor(resolved({ resellerStatus: status, tierMultiplier: null }), { role: "user" });
            const req = request();
            await expect(guard.canActivate(contextFor(req))).resolves.toBe(true);
            expect(req.apiCaller?.multiplier).toBe("1.000000");
        }
    });

    it("keeps existing discounts during review and after rejection", async () => {
        for (const status of ["pending", "rejected"]) {
            const req = request();
            await guardFor(resolved({ resellerStatus: status, tierMultiplier: "-0.1" })).canActivate(contextFor(req));
            expect(req.apiCaller?.multiplier).toBe("0.900000");
        }
    });

    it("rejects suspended open-platform access, including an admin's key", async () => {
        for (const role of ["user", "reseller", "admin"]) {
            const guard = guardFor(resolved({ resellerStatus: "suspended" }), { role });
            expect(await envelopeOf(guard.canActivate(contextFor(request())))).toMatchObject({ code: "reseller_suspended" });
        }
    });

    it("lets an admin's key through without its own approved application", async () => {
        const guard = guardFor(resolved({ resellerStatus: null }), { role: "admin" });
        const req = request();
        await expect(guard.canActivate(contextFor(req))).resolves.toBe(true);
        // No reseller account means no tier, so an admin is billed at list price.
        expect(req.apiCaller?.multiplier).toBe("1.000000");
    });

    it("rejects a key on a disabled account", async () => {
        const guard = guardFor(resolved(), { userStatus: "disabled" });
        expect(await envelopeOf(guard.canActivate(contextFor(request())))).toMatchObject({ code: "account_disabled" });
    });

    it("rejects a key that has spent its configured cap", async () => {
        const guard = guardFor(resolved({ quotaLimit: "10.000000", quotaUsed: "10.000000" }));
        expect(await envelopeOf(guard.canActivate(contextFor(request())))).toMatchObject({ type: "insufficient_quota", code: "api_key_quota_exhausted" });
    });

    it("allows polling and downloads at the quota ceiling but still rejects new paid submissions", async () => {
        const guard = guardFor(resolved({ quotaLimit: "10.000000", quotaUsed: "10.000000" }));
        const req = { ...request(), method: "GET" };
        await expect(guard.canActivate(contextFor(req))).resolves.toBe(true);
        expect(await envelopeOf(guard.canActivate(contextFor({ ...req, method: "POST" })))).toMatchObject({ code: "api_key_quota_exhausted" });
    });

    it("still allows a key below its cap", async () => {
        const guard = guardFor(resolved({ quotaLimit: "10.000000", quotaUsed: "9.999999" }));
        await expect(guard.canActivate(contextFor(request()))).resolves.toBe(true);
    });

    it("refuses every call while the site switch is off", async () => {
        const guard = guardFor(resolved(), { openPlatformEnabled: false });
        expect(await envelopeOf(guard.canActivate(contextFor(request())))).toMatchObject({ code: "platform_disabled" });
    });
});

describe("bearerToken", () => {
    it("reads the standard Bearer header case-insensitively", () => {
        expect(bearerToken({ authorization: "Bearer sk-jt-abc" })).toBe("sk-jt-abc");
        expect(bearerToken({ authorization: "bearer sk-jt-abc" })).toBe("sk-jt-abc");
    });

    it("also accepts the bare x-api-key form some clients send", () => {
        expect(bearerToken({ "x-api-key": "sk-jt-abc" })).toBe("sk-jt-abc");
    });

    it("returns an empty string when nothing was provided", () => {
        expect(bearerToken({})).toBe("");
    });
});

describe("clientIp", () => {
    it("takes the first hop of x-forwarded-for, which nginx sets", () => {
        expect(clientIp({ headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" }, ip: "10.0.0.1" })).toBe("203.0.113.10");
    });

    it("falls back to the socket address without a proxy", () => {
        expect(clientIp({ headers: {}, ip: "10.0.0.1" })).toBe("10.0.0.1");
        expect(clientIp({ headers: {} })).toBe("");
    });
});
