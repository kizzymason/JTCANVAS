import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { map, Observable } from "rxjs";
import { AUDIT_KEY, type AuditMeta } from "../decorators";
import type { RequestWithUser } from "../types";
import { AuditService } from "../../modules/audit/audit.service";

/**
 * Records privileged mutations after they succeed. Handlers that want a before/after diff put it on the
 * response under `audit`, which is stripped before the body reaches the client.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
    constructor(
        private readonly reflector: Reflector,
        private readonly audit: AuditService,
    ) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const meta = this.reflector.getAllAndOverride<AuditMeta>(AUDIT_KEY, [context.getHandler(), context.getClass()]);
        if (!meta) return next.handle();

        const request = context.switchToHttp().getRequest<RequestWithUser>();
        return next.handle().pipe(
            map((response) => {
                const payload = (response ?? {}) as { id?: string; audit?: { targetId?: string; before?: Record<string, unknown>; after?: Record<string, unknown> } };
                void this.audit.record({
                    actorId: request.user?.id,
                    actorName: request.user?.username,
                    action: meta.action,
                    targetType: meta.targetType,
                    targetId: payload.audit?.targetId ?? payload.id ?? "",
                    before: payload.audit?.before ?? null,
                    after: payload.audit?.after ?? null,
                    ip: request.ip ?? "",
                    userAgent: String(request.headers["user-agent"] ?? ""),
                });
                if (payload.audit === undefined) return response;
                const { audit: _audit, ...rest } = payload;
                return rest;
            }),
        );
    }
}
