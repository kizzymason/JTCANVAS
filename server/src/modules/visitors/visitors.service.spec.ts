import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgClient, type Database } from "../../db/db.module";
import * as schema from "../../db/schema";
import { visitorDailyStats, visitorEvents } from "../../db/schema";
import { MemoryRedis } from "../../test/memory-redis";
import { pruneVisitorEvents, VisitorsService } from "./visitors.service";
import { utcDateString } from "./visitors-classify";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://infinite:infinite@127.0.0.1:5442/infinite_canvas";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let client: postgres.Sql;
let db: Database;
let visitors: VisitorsService;

beforeAll(async () => {
    client = createPgClient(DATABASE_URL, 10);
    db = drizzle(client, { schema });
    visitors = new VisitorsService(db, new MemoryRedis() as never);
    await db.execute(sql`select 1`);
});

afterAll(async () => {
    await client.end({ timeout: 5 });
});

describe("VisitorsService.ingest", () => {
    it("increments daily totals before inserting detail, and UV only on first sighting", async () => {
        const visitorId = `testvid_${randomUUID().slice(0, 12)}`;
        const path = `/canvas/test-${randomUUID().slice(0, 8)}`;

        await visitors.ingest({ visitorId, ip: "10.0.0.9", userAgent: CHROME, device: "Windows · 1920x1080", path });
        await visitors.ingest({ visitorId, ip: "10.0.0.9", userAgent: CHROME, device: "Windows · 1920x1080", path });

        const today = utcDateString();
        const [sitewide] = await db
            .select()
            .from(visitorDailyStats)
            .where(and(eq(visitorDailyStats.statDate, today), eq(visitorDailyStats.path, "*"), eq(visitorDailyStats.kind, "human")));
        const [pathRow] = await db
            .select()
            .from(visitorDailyStats)
            .where(and(eq(visitorDailyStats.statDate, today), eq(visitorDailyStats.path, path), eq(visitorDailyStats.kind, "human")));
        const details = await db.select().from(visitorEvents).where(eq(visitorEvents.visitorId, visitorId));

        expect(details.length).toBe(2);
        expect(pathRow.pv).toBeGreaterThanOrEqual(2);
        expect(pathRow.uv).toBe(1);
        expect(sitewide.pv).toBeGreaterThanOrEqual(2);
        expect(sitewide.uv).toBeGreaterThanOrEqual(1);
    });

    it("keeps daily pv/uv after pruning events older than 30 days", async () => {
        const visitorId = `oldvid_${randomUUID().slice(0, 12)}`;
        const path = `/image/test-${randomUUID().slice(0, 8)}`;
        await visitors.ingest({ visitorId, ip: "10.0.0.8", userAgent: CHROME, device: "Windows", path });

        const today = utcDateString();
        const [before] = await db
            .select()
            .from(visitorDailyStats)
            .where(and(eq(visitorDailyStats.statDate, today), eq(visitorDailyStats.path, path), eq(visitorDailyStats.kind, "human")));

        await db.insert(visitorEvents).values({
            visitorId: `stale_${randomUUID().slice(0, 8)}`,
            ip: "10.0.0.8",
            userAgent: CHROME,
            device: "Windows",
            path,
            kind: "human",
            createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        });

        await pruneVisitorEvents(db);

        const stale = await db.select().from(visitorEvents).where(eq(visitorEvents.path, path));
        expect(stale.every((row) => row.createdAt.getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000)).toBe(true);

        const [after] = await db
            .select()
            .from(visitorDailyStats)
            .where(and(eq(visitorDailyStats.statDate, today), eq(visitorDailyStats.path, path), eq(visitorDailyStats.kind, "human")));
        expect(after.pv).toBe(before.pv);
        expect(after.uv).toBe(before.uv);
    });
});
