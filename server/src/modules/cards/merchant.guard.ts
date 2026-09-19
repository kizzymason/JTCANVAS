import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { forbidden, unauthorized } from "../../common/errors";
import { MerchantService, type ResolvedMerchant } from "./merchant.service";

export type RequestWithMerchant = {
    merchant?: ResolvedMerchant;
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
    user?: { id: string; username: string; role: string; sessionId: string };
};

/**
 * Bearer authentication for the sales-channel API. Runs after the global `AuthGuard` waves the route
 * through as `@Public()`, and is the only thing standing between a plaintext secret and the ability
 * to open checkouts in our name, so it checks the whole chain: secret validity, channel state and
 * source IP.
 */
@Injectable()
export class MerchantGuard implements CanActivate {
    constructor(private readonly merchants: MerchantService) {}

    async canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest<RequestWithMerchant>();
        const secret = bearerSecret(request.headers);
        if (!secret) throw unauthorized("缺少渠道密钥，请在 Authorization 头中以 Bearer 方式提供");

        const merchant = await this.merchants.resolveSecret(secret);
        if (!merchant) throw unauthorized("渠道密钥无效");
        if (!merchant.enabled) throw forbidden("该渠道已被停用");

        this.merchants.assertIpAllowed(merchant, clientIp(request));

        request.merchant = merchant;
        // Mirrored so the shared idempotency and audit interceptors keep working unchanged.
        request.user = { id: merchant.id, username: merchant.name, role: "user", sessionId: `merchant:${merchant.id}` };
        return true;
    }
}

export function bearerSecret(headers: Record<string, string | string[] | undefined>) {
    const raw = headers.authorization ?? headers.Authorization;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value?.toLowerCase().startsWith("bearer ")) return value.slice(7).trim();
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

export function userAgentOf(request: { headers: Record<string, string | string[] | undefined> }) {
    const raw = request.headers["user-agent"];
    return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}
