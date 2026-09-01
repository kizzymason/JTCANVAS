import { createHash } from "node:crypto";
import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { and, eq } from "drizzle-orm";
import { catchError, from, Observable, switchMap, tap, throwError } from "rxjs";
import { DB, type Database } from "../../db/db.module";
import { idempotencyKeys } from "../../db/schema";
import { IDEMPOTENT_KEY } from "../decorators";
import { badRequest, conflict } from "../errors";
import type { RequestWithUser } from "../types";

type ClaimResult = { replay: Record<string, unknown> } | { claimed: true };

/**
 * Protects money-moving endpoints from double submission. The key is claimed in the database *before*
 * the handler runs, so two concurrent identical submits cannot both freeze funds: the loser of the
 * unique-constraint race is told to retry instead of being charged again.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
    constructor(
        private readonly reflector: Reflector,
        @Inject(DB) private readonly db: Database,
    ) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const scope = this.reflector.getAllAndOverride<string>(IDEMPOTENT_KEY, [context.getHandler(), context.getClass()]);
        if (!scope) return next.handle();

        const request = context.switchToHttp().getRequest<RequestWithUser>();
        const header = request.headers["idempotency-key"];
        const key = Array.isArray(header) ? header[0] : header;
        if (!key) throw badRequest("IDEMPOTENCY_KEY_REQUIRED", "缺少 Idempotency-Key 请求头");

        const userId = request.user!.id;
        const requestHash = hash(request.body ?? {});

        return from(this.claim(userId, scope, key, requestHash)).pipe(
            switchMap((result) => {
                if ("replay" in result) return from([result.replay]);
                return next.handle().pipe(
                    tap((response) => void this.complete(userId, scope, key, response as Record<string, unknown>)),
                    // Release the claim on failure so the user can legitimately retry.
                    catchError((error) => from(this.release(userId, scope, key)).pipe(switchMap(() => throwError(() => error)))),
                );
            }),
        );
    }

    private async claim(userId: string, scope: string, key: string, requestHash: string): Promise<ClaimResult> {
        const inserted = await this.db.insert(idempotencyKeys).values({ userId, scope, key, requestHash }).onConflictDoNothing().returning({ id: idempotencyKeys.id });
        if (inserted.length) return { claimed: true };

        const [existing] = await this.db
            .select()
            .from(idempotencyKeys)
            .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
            .limit(1);
        if (!existing) return { claimed: true };
        if (existing.requestHash !== requestHash) throw conflict("IDEMPOTENCY_KEY_REUSED", "同一个 Idempotency-Key 被用于不同的请求内容");
        if (!existing.responseBody) throw conflict("IDEMPOTENT_REQUEST_IN_PROGRESS", "上一次相同请求仍在处理中，请稍后重试");
        return { replay: existing.responseBody };
    }

    private async complete(userId: string, scope: string, key: string, response: Record<string, unknown>) {
        await this.db
            .update(idempotencyKeys)
            .set({ responseBody: response ?? {} })
            .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
    }

    private async release(userId: string, scope: string, key: string) {
        await this.db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
    }
}

function hash(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
