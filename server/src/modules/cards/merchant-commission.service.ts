import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { DB, type Database, type DbTransaction } from "../../db/db.module";
import { cardMerchantLedger, cardMerchantPayouts, cardMerchants, cardOrders } from "../../db/schema";
import { badRequest, notFound } from "../../common/errors";
import { gte, money, toMoneyString, type MoneyInput } from "../../common/money";
import type { Paginated } from "../../common/types";

/**
 * Commission owed to sales channels, held to the same discipline as the user wallet: every movement
 * runs inside a transaction that locks the channel row first, arithmetic happens in SQL rather than
 * in JavaScript, and each movement appends a ledger row so the balance can always be replayed. The
 * `commission_balance >= 0` CHECK is the last line of defence, not the mechanism.
 *
 * The direction is the opposite of a wallet: this is money we owe out, so it accrues when a sale
 * settles and falls when an operator records a dividend they have actually paid.
 */
@Injectable()
export class MerchantCommissionService {
    private readonly logger = new Logger(MerchantCommissionService.name);

    constructor(@Inject(DB) private readonly db: Database) {}

    /** Locks the channel row for the rest of the transaction. Every writer must call this first. */
    async lockForUpdate(tx: DbTransaction, merchantId: string) {
        const [row] = await tx.select().from(cardMerchants).where(eq(cardMerchants.id, merchantId)).for("update").limit(1);
        if (!row) throw notFound("销售渠道不存在");
        return row;
    }

    /**
     * Records commission for a settled sale, inside the caller's transaction so the payment and the
     * accrual commit together.
     *
     * The unique index on `(order_id, type)` is what makes this safe against a replayed payment
     * notification: a second attempt violates it rather than paying the channel twice. Callers get
     * `false` back and can carry on.
     */
    async accrue(tx: DbTransaction, params: { merchantId: string; orderId: string; amount: MoneyInput; note?: string }) {
        const amount = toMoneyString(params.amount);
        if (!money(amount).gt(0)) return false;

        await this.lockForUpdate(tx, params.merchantId);
        const [updated] = await tx
            .update(cardMerchants)
            .set({ commissionBalance: sql`${cardMerchants.commissionBalance} + ${amount}::numeric`, updatedAt: new Date() })
            .where(eq(cardMerchants.id, params.merchantId))
            .returning();

        await tx.insert(cardMerchantLedger).values({
            merchantId: params.merchantId,
            type: "commission",
            amount,
            balanceAfter: updated.commissionBalance,
            orderId: params.orderId,
            note: params.note ?? "订单成交计提佣金",
        });
        return true;
    }

    /**
     * Takes back commission for a sale that was refunded or charged back. Clamped at the current
     * balance: if the dividend was already paid out we cannot un-pay it here, so the shortfall is
     * logged for an operator to net off the next payout rather than silently forcing the balance
     * negative.
     */
    async reverse(params: { merchantId: string; orderId: string; note?: string }) {
        return this.db.transaction(async (tx) => {
            const [order] = await tx.select().from(cardOrders).where(eq(cardOrders.id, params.orderId)).for("update").limit(1);
            if (!order) throw notFound("订单不存在");
            if (order.merchantId !== params.merchantId) throw badRequest("ORDER_MERCHANT_MISMATCH", "订单不属于该渠道");
            if (order.commissionState !== "accrued" && order.commissionState !== "pending") {
                return { reversed: "0.000000", shortfall: "0.000000" };
            }

            const merchant = await this.lockForUpdate(tx, params.merchantId);
            const owed = money(order.commissionAmount);
            const available = money(merchant.commissionBalance);
            const takeBack = owed.lte(available) ? owed : available;
            const shortfall = owed.minus(takeBack);

            if (takeBack.gt(0)) {
                const [updated] = await tx
                    .update(cardMerchants)
                    .set({ commissionBalance: sql`${cardMerchants.commissionBalance} - ${toMoneyString(takeBack)}::numeric`, updatedAt: new Date() })
                    .where(eq(cardMerchants.id, params.merchantId))
                    .returning();
                await tx.insert(cardMerchantLedger).values({
                    merchantId: params.merchantId,
                    type: "reversal",
                    amount: `-${toMoneyString(takeBack)}`,
                    balanceAfter: updated.commissionBalance,
                    orderId: params.orderId,
                    note: params.note ?? "订单退款，冲回佣金",
                    metadata: { shortfall: toMoneyString(shortfall) },
                });
            }

            await tx.update(cardOrders).set({ commissionState: "reversed", updatedAt: new Date() }).where(eq(cardOrders.id, params.orderId));

            if (shortfall.gt(0)) {
                this.logger.warn(`Channel ${params.merchantId} owes ${toMoneyString(shortfall)} back on order ${order.orderNo}: dividend already paid`);
            }
            return { reversed: toMoneyString(takeBack), shortfall: toMoneyString(shortfall) };
        });
    }

    /**
     * Records a dividend an operator has actually paid. Deliberately manual and never automatic:
     * money leaving the business is a human decision, and this only writes down what already happened.
     */
    async payout(params: { merchantId: string; amount: MoneyInput; method: string; reference: string; note: string; operatorId: string }) {
        const amount = toMoneyString(params.amount);
        if (!money(amount).gt(0)) throw badRequest("PAYOUT_AMOUNT_INVALID", "分红金额必须大于 0");

        return this.db.transaction(async (tx) => {
            const merchant = await this.lockForUpdate(tx, params.merchantId);
            if (!gte(merchant.commissionBalance, amount)) {
                throw badRequest("PAYOUT_EXCEEDS_BALANCE", `分红金额超过应付佣金：应付 ${merchant.commissionBalance}，本次 ${amount}`);
            }

            const [payout] = await tx
                .insert(cardMerchantPayouts)
                .values({
                    merchantId: params.merchantId,
                    amount,
                    method: params.method,
                    reference: params.reference,
                    note: params.note,
                    operatorId: params.operatorId,
                })
                .returning();

            const [updated] = await tx
                .update(cardMerchants)
                .set({ commissionBalance: sql`${cardMerchants.commissionBalance} - ${amount}::numeric`, updatedAt: new Date() })
                .where(eq(cardMerchants.id, params.merchantId))
                .returning();

            await tx.insert(cardMerchantLedger).values({
                merchantId: params.merchantId,
                type: "payout",
                amount: `-${amount}`,
                balanceAfter: updated.commissionBalance,
                payoutId: payout.id,
                operatorId: params.operatorId,
                note: params.note || "分红打款",
            });

            return { payoutId: payout.id, commissionBalance: updated.commissionBalance };
        });
    }

    /** Signed manual correction, for the cases a payout or reversal cannot express. */
    async adjust(params: { merchantId: string; amount: MoneyInput; operatorId: string; note: string }) {
        const amount = toMoneyString(params.amount);
        if (money(amount).isZero()) throw badRequest("ADJUST_AMOUNT_INVALID", "调整金额不能为 0");

        return this.db.transaction(async (tx) => {
            const merchant = await this.lockForUpdate(tx, params.merchantId);
            const next = money(merchant.commissionBalance).plus(money(amount));
            if (next.isNegative()) throw badRequest("ADJUST_BELOW_ZERO", `调整后应付佣金会变成负数，当前 ${merchant.commissionBalance}`);

            const [updated] = await tx
                .update(cardMerchants)
                .set({ commissionBalance: sql`${cardMerchants.commissionBalance} + ${amount}::numeric`, updatedAt: new Date() })
                .where(eq(cardMerchants.id, params.merchantId))
                .returning();

            await tx.insert(cardMerchantLedger).values({
                merchantId: params.merchantId,
                type: "adjust",
                amount,
                balanceAfter: updated.commissionBalance,
                operatorId: params.operatorId,
                note: params.note,
            });
            return { commissionBalance: updated.commissionBalance };
        });
    }

    /**
     * What is safe to pay out right now: accrued commission whose hold window has passed, less
     * everything already paid or reversed. The hold exists because a chargeback lands long after the
     * sale, and netting it off beats chasing a dividend that has already left the bank.
     */
    async summary(merchantId: string) {
        const merchant = await this.db.select().from(cardMerchants).where(eq(cardMerchants.id, merchantId)).limit(1);
        if (!merchant.length) throw notFound("销售渠道不存在");

        const [totals] = await this.db
            .select({
                grossSales: sql<string>`coalesce(sum(${cardOrders.amount}), 0)::text`,
                orders: sql<number>`count(*)::int`,
                commissionAccrued: sql<string>`coalesce(sum(case when ${cardOrders.commissionState} = 'accrued' then ${cardOrders.commissionAmount} else 0 end), 0)::text`,
                commissionHeld: sql<string>`coalesce(sum(case when ${cardOrders.commissionState} = 'accrued' and ${cardOrders.commissionPayableAt} > now() then ${cardOrders.commissionAmount} else 0 end), 0)::text`,
            })
            .from(cardOrders)
            .where(and(eq(cardOrders.merchantId, merchantId), eq(cardOrders.status, "paid")));

        const [paid] = await this.db
            .select({ total: sql<string>`coalesce(sum(${cardMerchantPayouts.amount}), 0)::text` })
            .from(cardMerchantPayouts)
            .where(eq(cardMerchantPayouts.merchantId, merchantId));

        const balance = merchant[0]!.commissionBalance;
        const held = totals?.commissionHeld ?? "0";
        // Anything still inside its hold window is owed but not yet safe to send.
        const payable = money(balance).minus(money(held));
        return {
            grossSales: totals?.grossSales ?? "0",
            paidOrders: totals?.orders ?? 0,
            commissionTotal: totals?.commissionAccrued ?? "0",
            commissionBalance: balance,
            commissionHeld: toMoneyString(held),
            commissionPayable: toMoneyString(payable.isNegative() ? 0 : payable),
            paidOut: paid?.total ?? "0",
        };
    }

    async ledger(merchantId: string, query: { page: number; pageSize: number }): Promise<Paginated<Record<string, unknown>>> {
        const where = eq(cardMerchantLedger.merchantId, merchantId);
        const [items, [counted]] = await Promise.all([
            this.db
                .select()
                .from(cardMerchantLedger)
                .where(where)
                .orderBy(desc(cardMerchantLedger.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(cardMerchantLedger).where(where),
        ]);
        return { items, total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    async payouts(merchantId: string | undefined, query: { page: number; pageSize: number }): Promise<Paginated<Record<string, unknown>>> {
        const where = merchantId ? eq(cardMerchantPayouts.merchantId, merchantId) : undefined;
        const [items, [counted]] = await Promise.all([
            this.db
                .select({
                    id: cardMerchantPayouts.id,
                    merchantId: cardMerchantPayouts.merchantId,
                    merchantName: cardMerchants.name,
                    amount: cardMerchantPayouts.amount,
                    method: cardMerchantPayouts.method,
                    reference: cardMerchantPayouts.reference,
                    note: cardMerchantPayouts.note,
                    createdAt: cardMerchantPayouts.createdAt,
                })
                .from(cardMerchantPayouts)
                .innerJoin(cardMerchants, eq(cardMerchants.id, cardMerchantPayouts.merchantId))
                .where(where)
                .orderBy(desc(cardMerchantPayouts.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(cardMerchantPayouts).where(where),
        ]);
        return { items, total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    /** Sales ranking across channels — which site is actually selling. */
    async leaderboard(params: { since?: Date } = {}) {
        const conditions = [eq(cardOrders.status, "paid"), isNotNull(cardOrders.merchantId)];
        if (params.since) conditions.push(sql`${cardOrders.paidAt} >= ${params.since.toISOString()}`);
        return this.db
            .select({
                merchantId: cardOrders.merchantId,
                merchantName: cardMerchants.name,
                orders: sql<number>`count(*)::int`,
                cards: sql<number>`coalesce(sum(${cardOrders.quantity}), 0)::int`,
                grossSales: sql<string>`coalesce(sum(${cardOrders.amount}), 0)::text`,
                commission: sql<string>`coalesce(sum(${cardOrders.commissionAmount}), 0)::text`,
            })
            .from(cardOrders)
            .innerJoin(cardMerchants, eq(cardMerchants.id, cardOrders.merchantId))
            .where(and(...conditions))
            .groupBy(cardOrders.merchantId, cardMerchants.name)
            .orderBy(desc(sql`sum(${cardOrders.amount})`));
    }

    /**
     * Channels whose ledger no longer sums to their balance. Never auto-corrects: a mismatch means
     * something wrote the balance outside a ledgered path and needs a human.
     */
    async reconcileAll() {
        const rows = await this.db
            .select({
                merchantId: cardMerchants.id,
                name: cardMerchants.name,
                balance: cardMerchants.commissionBalance,
                ledgerSum: sql<string>`coalesce((select sum(amount) from ${cardMerchantLedger} where ${cardMerchantLedger.merchantId} = ${cardMerchants.id}), 0)::text`,
            })
            .from(cardMerchants);
        return rows.filter((row) => !money(row.balance).eq(money(row.ledgerSum)));
    }
}
