import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import Redis from "ioredis";
import { DB, type Database } from "../../db/db.module";
import { visitorDailyStats, visitorEvents, type VisitorKind } from "../../db/schema";
import { REDIS } from "../../redis/redis.module";
import type { Paginated } from "../../common/types";
import {
    BOT_LANDING_THROTTLE_SECONDS,
    BURST_HIT_THRESHOLD,
    BURST_WINDOW_SECONDS,
    SITEWIDE_PATH,
    VISITOR_DETAIL_RETENTION_DAYS,
    VISITOR_UV_TTL_SECONDS,
    classifyVisitor,
    eachUtcDate,
    isBotUserAgent,
    utcDateString,
} from "./visitors-classify";

export { VISITOR_DETAIL_RETENTION_DAYS } from "./visitors-classify";

type IngestInput = {
    visitorId: string;
    userId?: string | null;
    ip: string;
    userAgent: string;
    device: string;
    path: string;
    webdriver?: boolean;
    /** Skip burst detection for crawler landings that are already classified as bot. */
    forceKind?: VisitorKind;
};

@Injectable()
export class VisitorsService {
    constructor(
        @Inject(DB) private readonly db: Database,
        @Inject(REDIS) private readonly redis: Redis,
    ) {}

    /**
     * Daily totals first, then the detail row. Charts keep working after the 30-day prune.
     */
    async ingest(input: IngestInput) {
        const burst = input.forceKind ? false : await this.markBurst(input.ip, input.path);
        const kind = input.forceKind ?? classifyVisitor({ ua: input.userAgent, webdriver: input.webdriver, burst });
        const date = utcDateString();
        await Promise.all([this.bumpDaily(date, input.path, kind, input.visitorId), this.bumpDaily(date, SITEWIDE_PATH, kind, input.visitorId)]);
        await this.db.insert(visitorEvents).values({
            visitorId: input.visitorId.slice(0, 64),
            userId: input.userId || null,
            ip: input.ip.slice(0, 64),
            userAgent: input.userAgent.slice(0, 512),
            device: input.device.slice(0, 256),
            path: input.path.slice(0, 200),
            kind,
        });
        return { ok: true as const, kind };
    }

    /** Known crawler hitting bootstrap: at most once per IP+UA every 30 minutes. */
    async recordBotLanding(input: { ip: string; userAgent: string }) {
        const ua = input.userAgent || "";
        if (!isBotUserAgent(ua)) return { recorded: false as const };
        const stamp = createHash("sha256").update(`${input.ip}\0${ua}`).digest("hex").slice(0, 24);
        const placed = await this.redis.set(`visitors:bot:${stamp}`, "1", "EX", BOT_LANDING_THROTTLE_SECONDS, "NX");
        if (placed !== "OK") return { recorded: false as const };
        await this.ingest({
            visitorId: `bot:${stamp}`,
            ip: input.ip,
            userAgent: ua,
            device: "crawler",
            path: "/",
            forceKind: "bot",
        });
        return { recorded: true as const };
    }

    async pruneEvents(now = new Date()) {
        return pruneVisitorEvents(this.db, now);
    }

    async summary() {
        const today = utcDateString();
        const from = utcDateString(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000));
        const rows = await this.db
            .select()
            .from(visitorDailyStats)
            .where(and(gte(visitorDailyStats.statDate, from)));

        const sitewide = rows.filter((row) => row.path === SITEWIDE_PATH);
        const byDate = new Map<string, { pv: number; uv: number; human: number; bot: number; suspected: number; humanUv: number; botUv: number; suspectedUv: number }>();
        for (const date of eachUtcDate(from, today)) {
            byDate.set(date, { pv: 0, uv: 0, human: 0, bot: 0, suspected: 0, humanUv: 0, botUv: 0, suspectedUv: 0 });
        }
        for (const row of sitewide) {
            const bucket = byDate.get(row.statDate);
            if (!bucket) continue;
            bucket.pv += row.pv;
            bucket.uv += row.uv;
            if (row.kind === "human") {
                bucket.human += row.pv;
                bucket.humanUv += row.uv;
            } else if (row.kind === "bot") {
                bucket.bot += row.pv;
                bucket.botUv += row.uv;
            } else {
                bucket.suspected += row.pv;
                bucket.suspectedUv += row.uv;
            }
        }

        const todayBucket = byDate.get(today) ?? { pv: 0, uv: 0, human: 0, bot: 0, suspected: 0, humanUv: 0, botUv: 0, suspectedUv: 0 };
        const days = [...byDate.entries()].map(([date, value]) => ({ date, ...value }));

        const pathRows = await this.db
            .select({
                path: visitorDailyStats.path,
                pv: sql<number>`coalesce(sum(${visitorDailyStats.pv}), 0)::int`,
                uv: sql<number>`coalesce(sum(${visitorDailyStats.uv}), 0)::int`,
            })
            .from(visitorDailyStats)
            .where(and(gte(visitorDailyStats.statDate, from), sql`${visitorDailyStats.path} <> ${SITEWIDE_PATH}`))
            .groupBy(visitorDailyStats.path)
            .orderBy(sql`sum(${visitorDailyStats.pv}) desc`)
            .limit(20);

        return {
            today: todayBucket,
            days,
            paths: pathRows,
        };
    }

    async listEvents(query: { page: number; pageSize: number; kind?: VisitorKind; path?: string; keyword?: string }): Promise<Paginated<(typeof visitorEvents)["$inferSelect"]>> {
        const keyword = query.keyword?.trim();
        const filters = [
            query.kind ? eq(visitorEvents.kind, query.kind) : undefined,
            query.path ? eq(visitorEvents.path, query.path) : undefined,
            keyword ? or(ilike(visitorEvents.ip, `%${keyword}%`), ilike(visitorEvents.userAgent, `%${keyword}%`), ilike(visitorEvents.path, `%${keyword}%`)) : undefined,
        ].filter(Boolean);
        const where = filters.length ? and(...filters) : undefined;
        const [items, [counted]] = await Promise.all([
            this.db
                .select()
                .from(visitorEvents)
                .where(where)
                .orderBy(desc(visitorEvents.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(visitorEvents).where(where),
        ]);
        return { items, total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    private async markBurst(ip: string, path: string) {
        const key = `visitors:burst:${ip}:${path}`;
        const hits = await this.redis.incr(key);
        if (hits === 1) await this.redis.expire(key, BURST_WINDOW_SECONDS);
        return hits >= BURST_HIT_THRESHOLD;
    }

    private async bumpDaily(statDate: string, path: string, kind: VisitorKind, visitorId: string) {
        const uvKey = `visitors:uv:${statDate}:${kind}:${path}`;
        const added = await this.redis.sadd(uvKey, visitorId);
        if (added === 1) await this.redis.expire(uvKey, VISITOR_UV_TTL_SECONDS);
        const uvDelta = added === 1 ? 1 : 0;
        await this.db
            .insert(visitorDailyStats)
            .values({ statDate, path, kind, pv: 1, uv: uvDelta })
            .onConflictDoUpdate({
                target: [visitorDailyStats.statDate, visitorDailyStats.path, visitorDailyStats.kind],
                set: {
                    pv: sql`${visitorDailyStats.pv} + 1`,
                    uv: sql`${visitorDailyStats.uv} + ${uvDelta}`,
                },
            });
    }
}

export async function pruneVisitorEvents(db: Database, now = new Date()) {
    const cutoff = new Date(now.getTime() - VISITOR_DETAIL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await db.delete(visitorEvents).where(lt(visitorEvents.createdAt, cutoff));
}

export function newVisitorId() {
    return randomBytes(16).toString("base64url");
}
