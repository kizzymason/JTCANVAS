import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DB, type Database, type DbTransaction } from "../../db/db.module";
import { orders, users, walletLedger, wallets } from "../../db/schema";
import { conflict, insufficientBalance, notFound } from "../../common/errors";
import { gte, subMoney, toMoneyString, type MoneyInput } from "../../common/money";
import type { Paginated } from "../../common/types";

type LedgerType = (typeof walletLedger.$inferInsert)["type"];

export type WalletSnapshot = {
    balance: string;
    frozen: string;
    totalRecharged: string;
    totalSpent: string;
};

/**
 * The single writer for balances. Every method follows the same discipline: open a transaction, lock the
 * wallet row with SELECT ... FOR UPDATE, mutate with SQL-side arithmetic, then append a ledger row.
 *
 * Ledger invariant: `amount` is always the signed change to *spendable balance*, which makes
 * `sum(amount) == balance` an exact, checkable invariant (see `reconcile`). Frozen funds are tracked
 * separately on the wallet row and are never part of the ledger sum.
 */
@Injectable()
export class WalletService {
    constructor(@Inject(DB) private readonly db: Database) {}

    async get(userId: string): Promise<WalletSnapshot> {
        const [wallet] = await this.db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
        if (!wallet) return { balance: "0", frozen: "0", totalRecharged: "0", totalSpent: "0" };
        return { balance: wallet.balance, frozen: wallet.frozen, totalRecharged: wallet.totalRecharged, totalSpent: wallet.totalSpent };
    }

    async ensureWallet(userId: string) {
        await this.db.insert(wallets).values({ userId }).onConflictDoNothing();
    }

    /**
     * Moves `amount` from spendable balance into frozen. Runs inside the caller's transaction so the
     * generation task row and the freeze commit atomically.
     */
    async freeze(tx: DbTransaction, params: { userId: string; amount: MoneyInput; taskId: string; note?: string }) {
        const amount = toMoneyString(params.amount);
        const wallet = await this.lock(tx, params.userId);
        if (!gte(wallet.balance, amount)) throw insufficientBalance(amount, wallet.balance);

        const [updated] = await tx
            .update(wallets)
            .set({
                balance: sql`${wallets.balance} - ${amount}::numeric`,
                frozen: sql`${wallets.frozen} + ${amount}::numeric`,
                updatedAt: new Date(),
            })
            .where(eq(wallets.userId, params.userId))
            .returning();

        await this.appendLedger(tx, {
            userId: params.userId,
            type: "freeze",
            amount: `-${amount}`,
            balanceAfter: updated.balance,
            frozenAfter: updated.frozen,
            taskId: params.taskId,
            note: params.note ?? "生成任务预扣",
        });
        return updated;
    }

    /**
     * Closes out a freeze. `actualAmount` may be lower than what was frozen when only some outputs
     * succeeded or a video came back shorter; the unused remainder returns to spendable balance.
     * The freeze row was already the charge, so the settle row records only the returned difference.
     */
    async settle(params: { userId: string; taskId: string; frozenAmount: MoneyInput; actualAmount: MoneyInput; note?: string }) {
        const frozen = toMoneyString(params.frozenAmount);
        const actual = toMoneyString(params.actualAmount);
        if (!gte(frozen, actual)) throw conflict("SETTLE_EXCEEDS_FREEZE", "结算金额不能超过冻结金额");
        const returned = toMoneyString(subMoney(frozen, actual));

        return this.db.transaction(async (tx) => {
            await this.lock(tx, params.userId);
            const [updated] = await tx
                .update(wallets)
                .set({
                    frozen: sql`${wallets.frozen} - ${frozen}::numeric`,
                    balance: sql`${wallets.balance} + ${returned}::numeric`,
                    totalSpent: sql`${wallets.totalSpent} + ${actual}::numeric`,
                    updatedAt: new Date(),
                })
                .where(eq(wallets.userId, params.userId))
                .returning();

            await this.appendLedger(tx, {
                userId: params.userId,
                type: "settle",
                amount: returned,
                balanceAfter: updated.balance,
                frozenAfter: updated.frozen,
                taskId: params.taskId,
                note: params.note ?? "生成任务结算",
                metadata: { frozen, actual, returned },
            });
            return updated;
        });
    }

    /** Releases a freeze in full. Used when a task fails: failures are never charged. */
    async release(params: { userId: string; taskId: string; amount: MoneyInput; note?: string }) {
        const amount = toMoneyString(params.amount);
        return this.db.transaction(async (tx) => {
            await this.lock(tx, params.userId);
            const [updated] = await tx
                .update(wallets)
                .set({
                    frozen: sql`${wallets.frozen} - ${amount}::numeric`,
                    balance: sql`${wallets.balance} + ${amount}::numeric`,
                    updatedAt: new Date(),
                })
                .where(eq(wallets.userId, params.userId))
                .returning();

            await this.appendLedger(tx, {
                userId: params.userId,
                type: "refund",
                amount,
                balanceAfter: updated.balance,
                frozenAfter: updated.frozen,
                taskId: params.taskId,
                note: params.note ?? "生成失败退回",
            });
            return updated;
        });
    }

    /** Adds spendable balance. Every increase creates an order so its origin is auditable. */
    async credit(params: {
        userId: string;
        amount: MoneyInput;
        type: Extract<LedgerType, "recharge" | "redeem" | "admin_adjust">;
        paymentProvider: string;
        note?: string;
        cardId?: string;
        operatorId?: string;
    }) {
        const amount = toMoneyString(params.amount);
        return this.db.transaction(async (tx) => {
            await this.lock(tx, params.userId);

            const [order] = await tx
                .insert(orders)
                .values({
                    userId: params.userId,
                    orderNo: orderNo(),
                    amount,
                    status: "paid",
                    paymentProvider: params.paymentProvider,
                    paidAt: new Date(),
                    metadata: { note: params.note ?? "", cardId: params.cardId ?? "" },
                })
                .returning();

            const [updated] = await tx
                .update(wallets)
                .set({
                    balance: sql`${wallets.balance} + ${amount}::numeric`,
                    totalRecharged: sql`${wallets.totalRecharged} + ${amount}::numeric`,
                    updatedAt: new Date(),
                })
                .where(eq(wallets.userId, params.userId))
                .returning();

            await this.appendLedger(tx, {
                userId: params.userId,
                type: params.type,
                amount,
                balanceAfter: updated.balance,
                frozenAfter: updated.frozen,
                orderId: order.id,
                cardId: params.cardId,
                operatorId: params.operatorId,
                note: params.note ?? "",
            });
            return { wallet: updated, order };
        });
    }

    /** Admin deduction. Refuses explicitly rather than letting the CHECK constraint abort the transaction. */
    async debitByAdmin(params: { userId: string; amount: MoneyInput; operatorId: string; note: string }) {
        const amount = toMoneyString(params.amount);
        return this.db.transaction(async (tx) => {
            const wallet = await this.lock(tx, params.userId);
            if (!gte(wallet.balance, amount)) throw insufficientBalance(amount, wallet.balance);

            const [updated] = await tx
                .update(wallets)
                .set({ balance: sql`${wallets.balance} - ${amount}::numeric`, updatedAt: new Date() })
                .where(eq(wallets.userId, params.userId))
                .returning();

            await this.appendLedger(tx, {
                userId: params.userId,
                type: "admin_adjust",
                amount: `-${amount}`,
                balanceAfter: updated.balance,
                frozenAfter: updated.frozen,
                operatorId: params.operatorId,
                note: params.note,
            });
            return updated;
        });
    }

    async listLedger(userId: string, query: { page: number; pageSize: number; type?: LedgerType }): Promise<Paginated<typeof walletLedger.$inferSelect>> {
        const where = query.type ? and(eq(walletLedger.userId, userId), eq(walletLedger.type, query.type)) : eq(walletLedger.userId, userId);
        const [items, [counted]] = await Promise.all([
            this.db
                .select()
                .from(walletLedger)
                .where(where)
                .orderBy(desc(walletLedger.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(walletLedger).where(where),
        ]);
        return { items, total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    async listOrders(userId: string, query: { page: number; pageSize: number }): Promise<Paginated<typeof orders.$inferSelect>> {
        const where = eq(orders.userId, userId);
        const [items, [counted]] = await Promise.all([
            this.db
                .select()
                .from(orders)
                .where(where)
                .orderBy(desc(orders.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(orders).where(where),
        ]);
        return { items, total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    /**
     * Reconciliation: sum of ledger amounts must equal the spendable balance exactly. A mismatch means
     * something wrote a balance outside this service, so it is reported rather than silently corrected.
     */
    async reconcile(userId: string) {
        const [row] = await this.db
            .select({ ledgerSum: sql<string>`coalesce(sum(${walletLedger.amount}), 0)::text` })
            .from(walletLedger)
            .where(eq(walletLedger.userId, userId));
        const wallet = await this.get(userId);
        const expected = toMoneyString(wallet.balance);
        const actual = toMoneyString(row?.ledgerSum ?? "0");
        return { userId, expected, actual, consistent: expected === actual };
    }

    /**
     * Finds every wallet whose ledger does not add up. A LEFT JOIN with GROUP BY rather than a
     * per-row correlated subquery: it is one pass, and it cannot accidentally decorrelate.
     */
    async reconcileAll() {
        const rows = await this.db
            .select({
                userId: wallets.userId,
                username: users.username,
                balance: wallets.balance,
                ledgerSum: sql<string>`coalesce(sum(${walletLedger.amount}), 0)::text`,
            })
            .from(wallets)
            .innerJoin(users, eq(users.id, wallets.userId))
            .leftJoin(walletLedger, eq(walletLedger.userId, wallets.userId))
            .groupBy(wallets.userId, wallets.balance, users.username);

        return rows
            .map((row) => ({ userId: row.userId, username: row.username, expected: toMoneyString(row.balance), actual: toMoneyString(row.ledgerSum) }))
            .filter((row) => row.expected !== row.actual);
    }

    /**
     * Takes the per-user write lock. Callers that need to serialise a whole multi-step operation for
     * one user (such as the generation submit path) acquire this first so their checks cannot race.
     */
    async lockForUpdate(tx: DbTransaction, userId: string) {
        return this.lock(tx, userId);
    }

    private async lock(tx: DbTransaction, userId: string) {
        const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).for("update").limit(1);
        if (!wallet) throw notFound("钱包不存在");
        return wallet;
    }

    private async appendLedger(
        tx: DbTransaction,
        entry: {
            userId: string;
            type: LedgerType;
            amount: string;
            balanceAfter: string;
            frozenAfter: string;
            taskId?: string;
            orderId?: string;
            cardId?: string;
            operatorId?: string;
            note?: string;
            metadata?: Record<string, unknown>;
        },
    ) {
        await tx.insert(walletLedger).values({
            userId: entry.userId,
            type: entry.type,
            amount: entry.amount,
            balanceAfter: entry.balanceAfter,
            frozenAfter: entry.frozenAfter,
            taskId: entry.taskId ?? null,
            orderId: entry.orderId ?? null,
            cardId: entry.cardId ?? null,
            operatorId: entry.operatorId ?? null,
            note: entry.note ?? "",
            metadata: entry.metadata ?? {},
        });
    }
}

function orderNo() {
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    return `IC${stamp}${randomBytes(4).toString("hex").toUpperCase()}`;
}
