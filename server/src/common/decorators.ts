import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { AuthUser, RequestWithUser, UserRole } from "./types";

export const IS_PUBLIC_KEY = "ic:isPublic";
export const ROLES_KEY = "ic:roles";
export const AUDIT_KEY = "ic:audit";
export const IDEMPOTENT_KEY = "ic:idempotent";

/** Opt a route out of AuthGuard. Everything else requires a session by default. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Shorthand for admin-only routes. */
export const AdminOnly = () => Roles("admin");

export type AuditMeta = { action: string; targetType?: string };

/** Records the call in audit_logs once it succeeds. Use on every privileged mutation. */
export const Audit = (meta: AuditMeta) => SetMetadata(AUDIT_KEY, meta);

/** Requires an Idempotency-Key header and replays the stored response for repeats. */
export const Idempotent = (scope: string) => SetMetadata(IDEMPOTENT_KEY, scope);

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    return request.user!;
});
