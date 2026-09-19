import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import Redis from "ioredis";
import { DB, type Database } from "../../db/db.module";
import { apiRequestLogs, apiUsageDaily } from "../../db/schema";
import { toMoneyString } from "../../common/money";
import { REDIS } from "../../redis/redis.module";
import { utcDateString } from "../visitors/visitors-classify";

/** One-second resolution counters, summed over a 60s window to produce QPS/RPM/TPM. */
const REALTIME_PREFIX = "openapi:rt:";
const REALTIME_WINDOW_SECONDS = 60;
const REALTIME_TTL_SECONDS = 120;

export type UsageRecord = {
    userId: string;
    apiKeyId: string | null;
    taskId?: string | null;
    channelId?: string | null;
    endpoint: string;
    capability?: string;
    model?: string;
    status: "success" | "failed";
    httpStatus: number;
    errorCode?: string;
    quantity?: number;
    inputTokens?: number;
    outputTokens?: number;
    billedAmount?: string;
    multiplier?: string;
    latencyMs: number;
    clientIp?: string;
    /** Async video creation is logged immediately, then finalized by the worker. */
    deferred?: boolean;
};

export type RealtimeThroughput = {
    qps: number;
    rpm: number;
    tpm: number;
    tasks: number;
};

/**
 * Writes the per-request audit trail.
 *
 * Three destinations, each for a different read pattern: the raw log for the console's log page, a
 * daily rollup so the dashboard never scans the log table, and short-lived Redis counters for the
 * live throughput tiles. Recording is best-effort — a failure here must never turn a successful
 * generation into an error for the caller.
 */
@Injectable()
export class UsageRecorderService {
    private readonly logger = new Logger(UsageRecorderService.name);

    constructor(
        @Inject(DB) private readonly db: Database,
        @Inject(REDIS) private readonly redis: Redis,
    ) {}

    async record(record: UsageRecord) {
        try {
            const inserted = await this.writeLog(record);
            // A task id is unique. If the worker won the async-finalization race, it already recorded
            // the complete request and this late controller insert must not increment the rollup.
            if (!inserted) return;
            await Promise.all([this.rollUp(record), this.bumpRealtime(record)]);
        } catch (error) {
            this.logger.error(`Failed to record open-platform usage: ${String(error)}`);
        }
    }

    /**
     * Completes the creation log for an asynchronous task. It is safe if the worker finishes before
     * the API process inserts the initial row: the unique task id lets whichever side arrives first
     * win without double-counting requests or money.
     */
    async finalizeDeferred(record: UsageRecord & { taskId: string }) {
        try {
            const final = { ...record, deferred: false };
            const inserted = await this.writeLog(final);
            if (inserted) {
                await Promise.all([this.rollUp(final), this.bumpRealtime(final)]);
                return;
            }

            const [claimed] = await this.db
                .update(apiRequestLogs)
                .set({
                    channelId: final.channelId ?? null,
                    capability: final.capability ?? "",
                    model: final.model ?? "",
                    status: final.status,
                    httpStatus: final.httpStatus,
                    errorCode: final.errorCode ?? "",
                    quantity: Math.max(0, Math.floor(final.quantity ?? 0)),
                    inputTokens: Math.max(0, Math.floor(final.inputTokens ?? 0)),
                    outputTokens: Math.max(0, Math.floor(final.outputTokens ?? 0)),
                    billedAmount: toMoneyString(final.billedAmount ?? 0),
                    multiplier: toMoneyString(final.multiplier ?? 1),
                    latencyMs: Math.max(0, Math.floor(final.latencyMs)),
                    settledAt: new Date(),
                })
                .where(and(eq(apiRequestLogs.taskId, final.taskId), isNull(apiRequestLogs.settledAt)))
                .returning({ id: apiRequestLogs.id });
            if (!claimed) return;

            // The creation row already contributed one request. Add only the values learned after
            // settlement; Redis likewise receives token throughput without a second request/task.
            await Promise.all([this.rollUp(final, 0), this.bumpRealtime(final, false)]);
        } catch (error) {
            this.logger.error(`Failed to finalize open-platform usage: ${String(error)}`);
        }
    }

    private async writeLog(record: UsageRecord) {
        const [row] = await this.db
            .insert(apiRequestLogs)
            .values({
                userId: record.userId,
                apiKeyId: record.apiKeyId,
                taskId: record.taskId ?? null,
                channelId: record.channelId ?? null,
                endpoint: record.endpoint,
                capability: record.capability ?? "",
                model: record.model ?? "",
                status: record.status,
                httpStatus: record.httpStatus,
                errorCode: record.errorCode ?? "",
                quantity: Math.max(0, Math.floor(record.quantity ?? 0)),
                inputTokens: Math.max(0, Math.floor(record.inputTokens ?? 0)),
                outputTokens: Math.max(0, Math.floor(record.outputTokens ?? 0)),
                billedAmount: toMoneyString(record.billedAmount ?? 0),
                multiplier: toMoneyString(record.multiplier ?? 1),
                latencyMs: Math.max(0, Math.floor(record.latencyMs)),
                clientIp: record.clientIp ?? "",
                settledAt: record.deferred ? null : new Date(),
            })
            .onConflictDoNothing()
            .returning({ id: apiRequestLogs.id });
        return Boolean(row);
    }

    /** Upsert-with-increment so concurrent requests on the same day cannot clobber each other. */
    private rollUp(record: UsageRecord, requestDelta = 1) {
        // UTC day keys, the same convention visitor_daily_stats already uses.
        const statDate = utcDateString();
        const failed = record.status === "failed" ? 1 : 0;
        const inputTokens = Math.max(0, Math.floor(record.inputTokens ?? 0));
        const outputTokens = Math.max(0, Math.floor(record.outputTokens ?? 0));
        const billedAmount = toMoneyString(record.billedAmount ?? 0);

        return this.db
            .insert(apiUsageDaily)
            .values({ userId: record.userId, statDate, requests: requestDelta, failedRequests: failed, inputTokens, outputTokens, billedAmount })
            .onConflictDoUpdate({
                target: [apiUsageDaily.userId, apiUsageDaily.statDate],
                set: {
                    requests: sql`${apiUsageDaily.requests} + ${requestDelta}`,
                    failedRequests: sql`${apiUsageDaily.failedRequests} + ${failed}`,
                    inputTokens: sql`${apiUsageDaily.inputTokens} + ${inputTokens}`,
                    outputTokens: sql`${apiUsageDaily.outputTokens} + ${outputTokens}`,
                    billedAmount: sql`${apiUsageDaily.billedAmount} + ${billedAmount}::numeric`,
                    updatedAt: new Date(),
                },
            });
    }

    private async bumpRealtime(record: UsageRecord, countRequest = true) {
        const second = Math.floor(Date.now() / 1000);
        const tokens = Math.max(0, Math.floor(record.inputTokens ?? 0)) + Math.max(0, Math.floor(record.outputTokens ?? 0));
        const pipeline = this.redis.multi();
        if (countRequest) {
            pipeline.incr(`${REALTIME_PREFIX}${record.userId}:req:${second}`).expire(`${REALTIME_PREFIX}${record.userId}:req:${second}`, REALTIME_TTL_SECONDS);
        }
        if (tokens) {
            pipeline.incrby(`${REALTIME_PREFIX}${record.userId}:tok:${second}`, tokens).expire(`${REALTIME_PREFIX}${record.userId}:tok:${second}`, REALTIME_TTL_SECONDS);
        }
        if (countRequest && record.taskId) {
            pipeline.incr(`${REALTIME_PREFIX}${record.userId}:task:${second}`).expire(`${REALTIME_PREFIX}${record.userId}:task:${second}`, REALTIME_TTL_SECONDS);
        }
        await pipeline.exec();
    }

    /**
     * Sums the last 60 one-second buckets. MGET over a known key list rather than SCAN, so the cost is
     * fixed and the dashboard's 5-second poll cannot degrade Redis.
     */
    async realtime(userId: string): Promise<RealtimeThroughput> {
        const now = Math.floor(Date.now() / 1000);
        const seconds = Array.from({ length: REALTIME_WINDOW_SECONDS }, (_value, index) => now - index);
        const [requests, tokens, tasks] = await Promise.all([
            this.sum(seconds.map((second) => `${REALTIME_PREFIX}${userId}:req:${second}`)),
            this.sum(seconds.map((second) => `${REALTIME_PREFIX}${userId}:tok:${second}`)),
            this.sum(seconds.map((second) => `${REALTIME_PREFIX}${userId}:task:${second}`)),
        ]);
        return {
            qps: Math.round((requests / REALTIME_WINDOW_SECONDS) * 100) / 100,
            rpm: requests,
            tpm: tokens,
            tasks,
        };
    }

    private async sum(keys: string[]) {
        if (!keys.length) return 0;
        const values = await this.redis.mget(keys);
        return values.reduce((total, value) => total + (value ? Number(value) || 0 : 0), 0);
    }
}

/**
 * Drops raw log rows past the retention window. The daily rollup is kept forever, so the console's
 * dashboard is unaffected — only the per-request log page loses the old rows.
 */
export async function pruneApiRequestLogs(db: Database, retentionDays: number, now = new Date()) {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) return;
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    await db.delete(apiRequestLogs).where(lt(apiRequestLogs.createdAt, cutoff));
}
