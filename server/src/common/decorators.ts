import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { AuthUser, RequestWithUser, UserRole } from "./types";

export const IS_PUBLIC_KEY = "ic:isPublic";
export const SKIP_SESSION_KEY = "ic:skipSession";
export const ROLES_KEY = "ic:roles";
export const AUDIT_KEY = "ic:audit";
export const IDEMPOTENT_KEY = "ic:idempotent";

/** Opt a route out of AuthGuard. Everything else requires a session by default. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Public high-frequency routes that must not wait on a Redis session lookup. */
export const SkipSession = () => SetMetadata(SKIP_SESSION_KEY, true);

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Shorthand for admin-only routes. */
export const AdminOnly = () => Roles("admin");

export type AuditMeta = { action: string; targetType?: string };

/** Records the call in audit_logs once it succeeds. Use on every privileged mutation. */
export const Audit = (meta: AuditMeta) => SetMetadata(AUDIT_KEY, meta);

export type IdempotentMeta = { scope: string; optional: boolean };

/**
 * Replays the stored response when the same Idempotency-Key comes back. The header is mandatory by
 * default; open-platform endpoints mark it optional because the OpenAI protocol does not require it
 * and a downstream SDK will not send one.
 */
export const Idempotent = (scope: string, opts?: { optional?: boolean }) =>
    SetMetadata(IDEMPOTENT_KEY, { scope, optional: opts?.optional ?? false } satisfies IdempotentMeta);

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    return request.user!;
});
