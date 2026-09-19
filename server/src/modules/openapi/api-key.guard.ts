import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DB, type Database } from "../../db/db.module";
import { users } from "../../db/schema";
import { money } from "../../common/money";
import { effectiveMultiplier } from "../pricing/reseller-multiplier";
import { SettingsService } from "../settings/settings.service";
import { ApiKeyService, type ResolvedApiKey } from "./api-key.service";
import { insufficientQuota, invalidApiKey, permissionDenied } from "./openai-errors";

/** Everything the `/v1` handlers need about the caller, attached to the request by this guard. */
export type ApiCaller = {
    userId: string;
    username: string;
    apiKey: ResolvedApiKey;
    multiplier: string;
};

export type RequestWithApiCaller = {
    apiCaller?: ApiCaller;
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
    user?: { id: string; username: string; role: string; sessionId: string; apiKeyId?: string };
};

/**
 * Bearer authentication for the open platform. Runs after the global `AuthGuard` waves the route
 * through as `@Public()`, and is the only thing standing between a plaintext token and the billing
 * pipeline, so it re-checks the whole chain: key validity, key state, reseller standing, account
 * standing, and wallet balance.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
    constructor(
        @Inject(DB) private readonly db: Database,
        private readonly keys: ApiKeyService,
        private readonly settings: SettingsService,
    ) {}

    async canActivate(context: ExecutionContext) {
        const site = await this.settings.getSite();
        if (site.openPlatformEnabled === false) throw permissionDenied("The open platform is currently disabled.", "platform_disabled");

        const request = context.switchToHttp().getRequest<RequestWithApiCaller>();
        const plaintext = bearerToken(request.headers);
        if (!plaintext) {
            throw invalidApiKey("You didn't provide an API key. Include it as `Authorization: Bearer <key>`.", "missing_api_key");
        }

        const apiKey = await this.keys.resolve(plaintext);
        if (!apiKey) throw invalidApiKey();
        if (apiKey.status !== "active") throw invalidApiKey("This API key has been disabled.", "api_key_disabled");
        if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= Date.now()) throw invalidApiKey("This API key has expired.", "api_key_expired");

        this.assertIpAllowed(apiKey, clientIp(request));

        const [account] = await this.db.select({ status: users.status, username: users.username, role: users.role }).from(users).where(eq(users.id, apiKey.userId)).limit(1);
        if (!account || account.status !== "active") throw permissionDenied("This account has been disabled.", "account_disabled");

        // Admins carry reseller privileges implicitly so they can exercise the API while supporting it.
        if (apiKey.resellerStatus !== "approved" && account.role !== "admin") {
            throw permissionDenied("This account is not an approved open-platform reseller.", "reseller_not_approved");
        }

        this.assertQuotaRemaining(apiKey);

        request.apiCaller = {
            userId: apiKey.userId,
            username: account.username,
            apiKey,
            multiplier: effectiveMultiplier({
                status: apiKey.resellerStatus,
                multiplierOverride: apiKey.multiplierOverride,
                tierMultiplier: apiKey.tierMultiplier,
            }),
        };
        // Mirrored onto `request.user` so shared interceptors (idempotency, audit) keep working.
        request.user = { id: apiKey.userId, username: account.username, role: account.role, sessionId: `apikey:${apiKey.id}`, apiKeyId: apiKey.id };
        return true;
    }

    private assertIpAllowed(apiKey: ResolvedApiKey, ip: string) {
        if (!apiKey.allowedIps.length) return;
        if (apiKey.allowedIps.includes(ip)) return;
        throw permissionDenied(`Requests from ${ip || "an unknown address"} are not allowed for this API key.`, "ip_restricted");
    }

    private assertQuotaRemaining(apiKey: ResolvedApiKey) {
        if (!apiKey.quotaLimit) return;
        if (money(apiKey.quotaUsed).lt(apiKey.quotaLimit)) return;
        throw insufficientQuota("This API key has reached its configured spend limit.", "api_key_quota_exhausted");
    }
}

export function bearerToken(headers: Record<string, string | string[] | undefined>) {
    const raw = headers.authorization ?? headers.Authorization;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value?.toLowerCase().startsWith("bearer ")) return value.slice(7).trim();
    // Anthropic-style clients send the key bare in `x-api-key`; accepting both costs nothing.
    const alt = headers["x-api-key"];
    const altValue = Array.isArray(alt) ? alt[0] : alt;
    return (altValue ?? value ?? "").trim();
}

export function clientIp(request: { headers: Record<string, string | string[] | undefined>; ip?: string }) {
    const forwarded = request.headers["x-forwarded-for"];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (value) return value.split(",")[0]!.trim();
    return request.ip ?? "";
}
