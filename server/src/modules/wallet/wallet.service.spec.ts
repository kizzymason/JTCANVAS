import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgClient, type Database } from "../../db/db.module";
import * as schema from "../../db/schema";
import { users, walletLedger, wallets, orders } from "../../db/schema";
import { toMoneyString } from "../../common/money";
import { WalletService } from "./wallet.service";

/**
 * Runs against the development Postgres because the guarantees under test are database guarantees:
 * row locking, the non-negative CHECK constraint, and transaction isolation. Mocking them would
 * only test the mock.
 */
const DATABASE_URL = process.env.DATABASE_URL || "postgres://infinite:infinite@127.0.0.1:5442/infinite_canvas";

let client: postgres.Sql;
let db: Database;
let wallet: WalletService;

async function createUser() {
    const username = `test_${randomUUID().slice(0, 12)}`;
    const [user] = await db.insert(users).values({ username, passwordHash: "x" }).returning();
    await db.insert(wallets).values({ userId: user.id });
    return user.id;
}

beforeAll(async () => {
    client = createPgClient(DATABASE_URL, 10);
    db = drizzle(client, { schema });
    wallet = new WalletService(db);
    // Fail loudly rather than silently skipping the most important tests in the suite.
    await db.execute(sql`select 1`);
});

afterAll(async () => {
    await client.end({ timeout: 5 });
});

describe("WalletService", () => {
    it("credits balance and records an auditable order plus ledger row", async () => {
        const userId = await createUser();
        const result = await wallet.credit({ userId, amount: "10.00", type: "recharge", paymentProvider: "card", note: "test" });

        expect(result.wallet.balance).toBe("10.000000");
        expect(result.order.status).toBe("paid");
        const ledger = await db.select().from(walletLedger).where(eq(walletLedger.userId, userId));
        expect(ledger).toHaveLength(1);
        expect(ledger[0].amount).toBe("10.000000");
        expect(ledger[0].balanceAfter).toBe("10.000000");
    });

    it("freezes funds inside a transaction, moving them out of spendable balance", async () => {
        const userId = await createUser();
        await wallet.credit({ userId, amount: "10.00", type: "recharge", paymentProvider: "card" });

        await db.transaction(async (tx) => {
            await wallet.freeze(tx, { userId, amount: "0.90", taskId: randomUUID() });
        });

        const snapshot = await wallet.get(userId);
        expect(snapshot.balance).toBe("9.100000");
        expect(snapshot.frozen).toBe("0.900000");
    });

    it("refuses to freeze more than the balance", async () => {
        const userId = await createUser();
        await wallet.credit({ userId, amount: "1.00", type: "recharge", paymentProvider: "card" });

        await expect(
            db.transaction(async (tx) => {
                await wallet.freeze(tx, { userId, amount: "2.00", taskId: randomUUID() });
            }),
        ).rejects.toThrow();

        const snapshot = await wallet.get(userId);
        expect(snapshot.balance).toBe("1.000000");
        expect(snapshot.frozen).toBe("0.000000");
    });

    it("settles for less than was frozen and returns the difference", async () => {
        const userId = await createUser();
        const taskId = randomUUID();
        await wallet.credit({ userId, amount: "10.00", type: "recharge", paymentProvider: "card" });
        await db.transaction(async (tx) => wallet.freeze(tx, { userId, amount: "0.90", taskId }));

        await wallet.settle({ userId, taskId, frozenAmount: "0.90", actualAmount: "0.30" });

        const snapshot = await wallet.get(userId);
        // Charged 0.30 of the 0.90 reserved, so 0.60 came back.
        expect(snapshot.balance).toBe("9.700000");
        expect(snapshot.frozen).toBe("0.000000");
        expect(snapshot.totalSpent).toBe("0.300000");
    });

    it("releases the full amount on failure so a failed task costs nothing", async () => {
        const userId = await createUser();
        const taskId = randomUUID();
        await wallet.credit({ userId, amount: "5.00", type: "recharge", paymentProvider: "card" });
        await db.transaction(async (tx) => wallet.freeze(tx, { userId, amount: "1.25", taskId }));

        await wallet.release({ userId, taskId, amount: "1.25" });

        const snapshot = await wallet.get(userId);
        expect(snapshot.balance).toBe("5.000000");
        expect(snapshot.frozen).toBe("0.000000");
        expect(snapshot.totalSpent).toBe("0.000000");
    });

    it("rejects a settlement larger than the freeze", async () => {
        const userId = await createUser();
        const taskId = randomUUID();
        await wallet.credit({ userId, amount: "5.00", type: "recharge", paymentProvider: "card" });
        await db.transaction(async (tx) => wallet.freeze(tx, { userId, amount: "1.00", taskId }));

        await expect(wallet.settle({ userId, taskId, frozenAmount: "1.00", actualAmount: "2.00" })).rejects.toThrow();
    });

    it("refuses an admin debit that would go negative", async () => {
        const userId = await createUser();
        await wallet.credit({ userId, amount: "1.00", type: "recharge", paymentProvider: "card" });

        await expect(wallet.debitByAdmin({ userId, amount: "5.00", operatorId: userId, note: "test" })).rejects.toThrow();
        expect((await wallet.get(userId)).balance).toBe("1.000000");
    });

    /**
     * The important one: many concurrent freezes against a balance that can only cover some of them.
     * Row locking must serialise them so the wallet never goes negative and never over-commits.
     */
    it("serialises concurrent freezes without over-spending", async () => {
        const userId = await createUser();
        await wallet.credit({ userId, amount: "1.00", type: "recharge", paymentProvider: "card" });

        const attempts = 20;
        const each = "0.10";
        const results = await Promise.allSettled(
            Array.from({ length: attempts }, () =>
                db.transaction(async (tx) => {
                    await wallet.freeze(tx, { userId, amount: each, taskId: randomUUID() });
                }),
            ),
        );

        const succeeded = results.filter((item) => item.status === "fulfilled").length;
        const snapshot = await wallet.get(userId);

        // At most 10 of the 20 attempts can fit into 1.00 at 0.10 each.
        expect(succeeded).toBeLessThanOrEqual(10);
        expect(toMoneyString(snapshot.frozen)).toBe(toMoneyString(String(succeeded * 0.1)));
        expect(Number(snapshot.balance)).toBeGreaterThanOrEqual(0);
        expect(Number(snapshot.balance) + Number(snapshot.frozen)).toBeCloseTo(1, 6);
    });

    it("keeps the ledger sum equal to the spendable balance", async () => {
        const userId = await createUser();
        const taskId = randomUUID();
        await wallet.credit({ userId, amount: "20.00", type: "recharge", paymentProvider: "card" });
        await wallet.credit({ userId, amount: "5.00", type: "redeem", paymentProvider: "card" });
        await db.transaction(async (tx) => wallet.freeze(tx, { userId, amount: "3.00", taskId }));
        await wallet.settle({ userId, taskId, frozenAmount: "3.00", actualAmount: "1.20" });
        await wallet.debitByAdmin({ userId, amount: "2.00", operatorId: userId, note: "test" });

        const reconciliation = await wallet.reconcile(userId);
        expect(reconciliation.consistent).toBe(true);

        // 20 + 5 - 1.20 - 2 = 21.80
        expect((await wallet.get(userId)).balance).toBe("21.800000");
    });

    it("reports nothing when every wallet reconciles", async () => {
        const userId = await createUser();
        await wallet.credit({ userId, amount: "1.00", type: "recharge", paymentProvider: "card" });
        const mismatches = await wallet.reconcileAll();
        expect(mismatches.find((item) => item.userId === userId)).toBeUndefined();
    });

    it("detects a balance written outside the wallet service", async () => {
        const userId = await createUser();
        await wallet.credit({ userId, amount: "1.00", type: "recharge", paymentProvider: "card" });
        // Simulate a rogue write; reconciliation exists precisely to catch this.
        await db.update(wallets).set({ balance: "999.000000" }).where(eq(wallets.userId, userId));

        const reconciliation = await wallet.reconcile(userId);
        expect(reconciliation.consistent).toBe(false);
        expect(reconciliation.expected).toBe("999.000000");
        expect(reconciliation.actual).toBe("1.000000");

        const mismatches = await wallet.reconcileAll();
        const mismatch = mismatches.find((item) => item.userId === userId);
        expect(mismatch?.username).toBeTruthy();
        expect(mismatch?.expected).toBe("999.000000");
        expect(mismatch?.actual).toBe("1.000000");
    });

    it("enforces the non-negative constraint at the database level", async () => {
        const userId = await createUser();
        // Last line of defence: even a direct UPDATE must not be able to go negative.
        await expect(db.update(wallets).set({ balance: "-1.000000" }).where(eq(wallets.userId, userId))).rejects.toThrow();
    });

    it("credits a pending gateway order once and ignores a second fulfill", async () => {
        const userId = await createUser();
        const pending = await wallet.createPendingOrder({
            userId,
            amount: "10.00",
            paymentProvider: "alipay",
            metadata: { creditAmount: "12.000000" },
        });
        expect(pending.status).toBe("pending");

        const first = await wallet.fulfillPendingOrder({ orderNo: pending.orderNo, paidAmount: "10.00", providerTxnId: "T1" });
        expect(first.alreadyPaid).toBe(false);
        expect((await wallet.get(userId)).balance).toBe("12.000000");
        expect((await wallet.get(userId)).totalRecharged).toBe("12.000000");

        const second = await wallet.fulfillPendingOrder({ orderNo: pending.orderNo, paidAmount: "10.00", providerTxnId: "T1" });
        expect(second.alreadyPaid).toBe(true);
        expect((await wallet.get(userId)).balance).toBe("12.000000");

        const ledger = await db.select().from(walletLedger).where(eq(walletLedger.userId, userId));
        expect(ledger).toHaveLength(1);
        const [order] = await db.select().from(orders).where(eq(orders.orderNo, pending.orderNo));
        expect(order.status).toBe("paid");
        expect(order.amount).toBe("10.000000");
    });

    it("rejects a notify whose money does not match the pending order", async () => {
        const userId = await createUser();
        const pending = await wallet.createPendingOrder({
            userId,
            amount: "10.00",
            paymentProvider: "alipay",
            metadata: { creditAmount: "10.000000" },
        });
        await expect(wallet.fulfillPendingOrder({ orderNo: pending.orderNo, paidAmount: "9.99", providerTxnId: "T2" })).rejects.toThrow();
        expect((await wallet.get(userId)).balance).toBe("0.000000");
        const [order] = await db.select().from(orders).where(eq(orders.orderNo, pending.orderNo));
        expect(order.status).toBe("pending");
    });
});
