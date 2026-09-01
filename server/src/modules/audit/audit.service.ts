import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { DB, type Database } from "../../db/db.module";
import { auditLogs } from "../../db/schema";
import type { Paginated } from "../../common/types";

export type AuditEntry = {
    actorId?: string;
    actorName?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    ip?: string;
    userAgent?: string;
};

@Injectable()
export class AuditService {
    constructor(@Inject(DB) private readonly db: Database) {}

    /** Never throws into the request path: an audit write failure must not undo a successful mutation. */
    async record(entry: AuditEntry) {
        try {
            await this.db.insert(auditLogs).values({
                actorId: entry.actorId ?? null,
                actorName: entry.actorName ?? "",
                action: entry.action,
                targetType: entry.targetType ?? "",
                targetId: entry.targetId ?? "",
                before: entry.before ?? null,
                after: entry.after ?? null,
                ip: entry.ip ?? "",
                userAgent: (entry.userAgent ?? "").slice(0, 512),
            });
        } catch {
            // Swallowed deliberately; the pino logger already captured the mutation.
        }
    }

    async list(query: { page: number; pageSize: number; action?: string; from?: Date; to?: Date }): Promise<Paginated<typeof auditLogs.$inferSelect>> {
        const filters = [
            query.action ? eq(auditLogs.action, query.action) : undefined,
            query.from ? gte(auditLogs.createdAt, query.from) : undefined,
            query.to ? lte(auditLogs.createdAt, query.to) : undefined,
        ].filter(Boolean);
        const where = filters.length ? and(...filters) : undefined;

        const [items, [counted]] = await Promise.all([
            this.db
                .select()
                .from(auditLogs)
                .where(where)
                .orderBy(desc(auditLogs.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where),
        ]);
        return { items, total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }
}
