import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPgClient, type Database } from "../../db/db.module";
import * as schema from "../../db/schema";
import { users, walletLedger, wallets } from "../../db/schema";
import { AppError } from "../../common/errors";
import { WalletService } from "../wallet/wallet.service";
import { AdminService } from "./admin.service";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://infinite:infinite@127.0.0.1:5442/infinite_canvas";

let client: postgres.Sql;
let db: Database;
let wallet: WalletService;
let admin: AdminService;

async function createUser(role: "user" | "admin" = "user") {
    const username = `test_${randomUUID().slice(0, 12)}`;
    const [user] = await db.insert(users).values({ username, passwordHash: "x", role }).returning();
    await db.insert(wallets).values({ userId: user.id });
    return user;
}

function errorBody(error: unknown) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).getResponse() as { code: string; message: string };
}

beforeAll(async () => {
    client = createPgClient(DATABASE_URL, 10);
    db = drizzle(client, { schema });
    wallet = new WalletService(db);
    admin = new AdminService(
        db,
        {} as never,
        { invalidate: async () => undefined } as never,
        wallet,
        { revokeAllForUser: vi.fn(async () => undefined), refreshPayload: vi.fn(async () => undefined) } as never,
        {} as never,
        { purgeAllForOwner: vi.fn(async () => 0) } as never,
    );
    await db.execute(sql`select 1`);
});

afterAll(async () => {
    await client.end({ timeout: 5 });
});

describe("AdminService.deleteUsers", () => {
    it("refuses to delete the operator", async () => {
        const operator = await createUser();
        const error = await admin.deleteUsers([operator.id], operator.id).catch((item) => item);
        expect(errorBody(error)).toMatchObject({ code: "FORBIDDEN", message: "不能删除当前登录账号" });
        expect((await db.select().from(users).where(eq(users.id, operator.id))).length).toBe(1);
    });

    it("refuses a batch that would remove every remaining admin", async () => {
        const operator = await createUser();
        const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
        expect(admins.length).toBeGreaterThan(0);
        const error = await admin.deleteUsers(
            admins.map((item) => item.id),
            operator.id,
        ).catch((item) => item);
        expect(errorBody(error)).toMatchObject({ code: "FORBIDDEN", message: "不能删除最后一个管理员" });
    });

    it("refuses a user with frozen balance", async () => {
        const operator = await createUser();
        const target = await createUser();
        await wallet.credit({ userId: target.id, amount: "10.00", type: "recharge", paymentProvider: "card" });
        await db.transaction(async (tx) => wallet.freeze(tx, { userId: target.id, amount: "1.00", taskId: randomUUID() }));

        const error = await admin.deleteUsers([target.id], operator.id).catch((item) => item);
        expect(errorBody(error)).toMatchObject({ code: "USER_HAS_FROZEN_BALANCE" });
        expect((await db.select().from(users).where(eq(users.id, target.id))).length).toBe(1);
    });

    it("deletes a regular user and cascades the wallet ledger", async () => {
        const operator = await createUser();
        const target = await createUser();
        await wallet.credit({ userId: target.id, amount: "3.00", type: "recharge", paymentProvider: "card" });

        const result = await admin.deleteUsers([target.id], operator.id);
        expect(result.removed).toBe(1);
        expect(await db.select().from(users).where(eq(users.id, target.id))).toHaveLength(0);
        expect(await db.select().from(wallets).where(eq(wallets.userId, target.id))).toHaveLength(0);
        expect(await db.select().from(walletLedger).where(eq(walletLedger.userId, target.id))).toHaveLength(0);
    });
});
