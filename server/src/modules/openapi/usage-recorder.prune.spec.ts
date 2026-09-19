import { describe, expect, it } from "vitest";
import type { Database } from "../../db/db.module";
import { pruneApiRequestLogs } from "./usage-recorder.service";

function fakeDb() {
    const cutoffs: Date[] = [];
    const db = {
        delete() {
            return {
                where(condition: { queryChunks?: unknown[] }) {
                    // drizzle wraps bound values in a Param, so the cutoff sits one level in.
                    for (const chunk of (condition.queryChunks ?? []).flat()) {
                        const value = chunk instanceof Date ? chunk : (chunk as { value?: unknown } | null)?.value;
                        if (value instanceof Date) cutoffs.push(value);
                    }
                    return Promise.resolve();
                },
            };
        },
    };
    return { db: db as unknown as Database, cutoffs };
}

describe("pruneApiRequestLogs", () => {
    const now = new Date("2026-09-03T03:00:00.000Z");

    it("deletes rows older than the retention window", async () => {
        const { db, cutoffs } = fakeDb();
        await pruneApiRequestLogs(db, 90, now);
        expect(cutoffs).toHaveLength(1);
        expect(cutoffs[0].toISOString()).toBe("2026-06-05T03:00:00.000Z");
    });

    it("treats a non-positive or unparseable retention as disabled instead of wiping the table", async () => {
        for (const retention of [0, -1, Number.NaN]) {
            const { db, cutoffs } = fakeDb();
            await pruneApiRequestLogs(db, retention, now);
            expect(cutoffs).toHaveLength(0);
        }
    });
});
