import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "../../common/errors";
import { createPgClient, type Database } from "../../db/db.module";
import * as schema from "../../db/schema";
import { registrationLocks, users, wallets } from "../../db/schema";
import { MemoryRedis } from "../../test/memory-redis";
import { AuthService } from "./auth.service";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://infinite:infinite@127.0.0.1:5442/infinite_canvas";
const FINGERPRINT = "ab".repeat(32);

let client: postgres.Sql;
let db: Database;
let redis: MemoryRedis;
let auth: AuthService;

function errorBody(error: unknown) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).getResponse() as { code: string; message: string };
}

beforeAll(async () => {
    client = createPgClient(DATABASE_URL, 10);
    db = drizzle(client, { schema });
    redis = new MemoryRedis();
    auth = new AuthService(
        db,
        redis as never,
        { create: vi.fn(async () => "session-id") } as never,
        { getSite: async () => ({ registrationEnabled: true, newUserGiftAmount: "0" }) } as never,
        { credit: vi.fn() } as never,
    );
    await db.execute(sql`select 1`);
});

afterAll(async () => {
    await client.end({ timeout: 5 });
});

describe("AuthService.register device lock", () => {
    it("rejects a second successful registration on the same fingerprint within 365 days", async () => {
        const [seed] = await db.insert(users).values({ username: `seed_${randomUUID().slice(0, 10)}`, passwordHash: "x" }).returning();
        await db.insert(wallets).values({ userId: seed.id });

        await db.delete(registrationLocks).where(eq(registrationLocks.fingerprintHash, FINGERPRINT));
        await db.insert(registrationLocks).values({
            fingerprintHash: FINGERPRINT,
            ip: "203.0.113.9",
            userId: seed.id,
            registeredAt: new Date(),
        });

        const error = await auth
            .register(
                {
                    username: `lock_${randomUUID().slice(0, 8)}`,
                    password: "password12",
                    fingerprint: FINGERPRINT,
                },
                { ip: "203.0.113.10", userAgent: "Mozilla/5.0" },
            )
            .catch((item) => item);

        expect(errorBody(error)).toMatchObject({ code: "DEVICE_REGISTERED", message: "该设备已注册过账号，请直接登录" });
    });

    it("rejects a shared zero fingerprint instead of locking every failed client together", async () => {
        const error = await auth
            .register(
                {
                    username: `zero_${randomUUID().slice(0, 8)}`,
                    password: "password12",
                    fingerprint: "0".repeat(64),
                },
                { ip: "203.0.113.12", userAgent: "Mozilla/5.0" },
            )
            .catch((item) => item);
        expect(errorBody(error)).toMatchObject({ code: "INVALID_FINGERPRINT" });
    });

    it("rejects a honeypot submission without creating a user", async () => {
        const username = `hp_${randomUUID().slice(0, 8)}`;
        const error = await auth
            .register(
                {
                    username,
                    password: "password12",
                    fingerprint: FINGERPRINT,
                    website: "http://spam.test",
                },
                { ip: "203.0.113.11", userAgent: "Mozilla/5.0" },
            )
            .catch((item) => item);
        expect(errorBody(error)).toMatchObject({ code: "REGISTER_REJECTED" });
        const rows = await db.select().from(users).where(eq(users.username, username));
        expect(rows.length).toBe(0);
    });
});
