import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { DB, type Database } from "../../db/db.module";
import { cardMerchants, cardOrderItems, cardOrders, cardProducts } from "../../db/schema";
import { badRequest, notFound } from "../../common/errors";
import { gte, toMoneyString } from "../../common/money";
import type { Paginated } from "../../common/types";
import { MerchantCommissionService } from "./merchant-commission.service";
import { MerchantService } from "./merchant.service";
import type {
    AdjustCardMerchantCommissionDto,
    CardMerchantPayoutDto,
    CardMerchantScopedQueryDto,
    PaginationQueryDto,
    ReplaceCardMerchantPricesDto,
    ReverseCardCommissionDto,
    UpsertCardMerchantDto,
} from "./dto/card-dist.dto";

/** Admin side of channel sales: who sells, what we owe them, and what we have actually paid. */
@Injectable()
export class CardDistAdminService {
    constructor(
        @Inject(DB) private readonly db: Database,
        private readonly merchants: MerchantService,
        private readonly commission: MerchantCommissionService,
    ) {}

    async listMerchants() {
        const [listed, sales] = await Promise.all([this.merchants.list(), this.salesByMerchant()]);
        return {
            items: listed.items.map((item) => ({
                ...item,
                grossSales: sales.get(item.id)?.grossSales ?? "0.000000",
                paidOrders: sales.get(item.id)?.orders ?? 0,
                cardsSold: sales.get(item.id)?.cards ?? 0,
                commissionTotal: sales.get(item.id)?.commission ?? "0.000000",
                refundedOrders: sales.get(item.id)?.refunded ?? 0,
            })),
        };
    }

    async createMerchant(input: UpsertCardMerchantDto) {
        const result = await this.merchants.create(input);
        return { ...result, audit: { targetId: result.merchant.id, after: auditMerchant(result.merchant) } };
    }

    async updateMerchant(id: string, input: UpsertCardMerchantDto) {
        const result = await this.merchants.update(id, input);
        return { merchant: result.merchant, audit: { targetId: id, before: auditMerchant(result.before), after: auditMerchant(result.merchant) } };
    }

    async reissueSecret(id: string) {
        const result = await this.merchants.reissueSecret(id);
        return { ...result, audit: { targetId: id, after: { reissued: true } } };
    }

    async removeMerchant(id: string) {
        const result = await this.merchants.remove(id);
        return { id: result.id, audit: { targetId: id, before: auditMerchant(result.before) } };
    }

    async replacePrices(id: string, input: ReplaceCardMerchantPricesDto) {
        for (const price of input.prices) {
            if (!gte(toMoneyString(price.unitPrice), "0.01")) throw badRequest("MERCHANT_PRICE_INVALID", "售价必须大于 0");
            const [product] = await this.db.select({ id: cardProducts.id }).from(cardProducts).where(eq(cardProducts.id, price.productId)).limit(1);
            if (!product) throw notFound("商品不存在");
        }
        const result = await this.merchants.replacePrices(id, input.prices);
        await this.merchants.invalidateById(id);
        return { ...result, audit: { targetId: id, after: { prices: input.prices } } };
    }

    /** Records a dividend the operator has already transferred. Never moves money itself. */
    async payout(id: string, input: CardMerchantPayoutDto, operatorId: string) {
        const summary = await this.commission.summary(id);
        if (!gte(summary.commissionPayable, toMoneyString(input.amount))) {
            throw badRequest(
                "PAYOUT_EXCEEDS_PAYABLE",
                `可结算佣金不足：可结算 ${summary.commissionPayable}，其中 ${summary.commissionHeld} 仍在冻结期内，本次 ${input.amount}`,
            );
        }
        const result = await this.commission.payout({
            merchantId: id,
            amount: input.amount,
            method: input.method,
            reference: input.reference ?? "",
            note: input.note ?? "",
            operatorId,
        });
        await this.merchants.invalidateById(id);
        return { ...result, audit: { targetId: id, after: { amount: input.amount, method: input.method, reference: input.reference ?? "" } } };
    }

    async adjustCommission(id: string, input: AdjustCardMerchantCommissionDto, operatorId: string) {
        const result = await this.commission.adjust({ merchantId: id, amount: input.amount, operatorId, note: input.note });
        await this.merchants.invalidateById(id);
        return { ...result, audit: { targetId: id, after: { amount: input.amount, note: input.note } } };
    }

    /** Takes commission back for an order that was refunded, so a dividend is not paid on it. */
    async reverseCommission(input: ReverseCardCommissionDto, operatorId: string) {
        const [order] = await this.db.select().from(cardOrders).where(eq(cardOrders.orderNo, input.orderNo.trim())).limit(1);
        if (!order) throw notFound("订单不存在");
        if (!order.merchantId) throw badRequest("ORDER_NOT_CHANNEL", "该订单不是渠道订单，没有佣金可冲回");
        const result = await this.commission.reverse({ merchantId: order.merchantId, orderId: order.id, note: input.note });
        await this.merchants.invalidateById(order.merchantId);
        return { ...result, audit: { targetId: order.merchantId, after: { orderNo: order.orderNo, note: input.note, operatorId } } };
    }

    summary(id: string) {
        return this.commission.summary(id);
    }

    ledger(id: string, query: PaginationQueryDto) {
        return this.commission.ledger(id, query);
    }

    payouts(query: CardMerchantScopedQueryDto) {
        return this.commission.payouts(query.merchantId, query);
    }

    /** Which site is actually selling — the ranking the payout decision is made from. */
    async leaderboard(days?: number) {
        const since = days && days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;
        return { items: await this.commission.leaderboard({ since }), since: since?.toISOString() ?? "" };
    }

    /** Channel sales, with the codes each one delivered so support can verify a buyer's claim. */
    async listOrders(query: CardMerchantScopedQueryDto): Promise<Paginated<Record<string, unknown>>> {
        const conditions = [isNotNull(cardOrders.merchantId)];
        if (query.merchantId) conditions.push(eq(cardOrders.merchantId, query.merchantId));
        const where = and(...conditions);
        const [items, [counted]] = await Promise.all([
            this.db
                .select({
                    id: cardOrders.id,
                    orderNo: cardOrders.orderNo,
                    merchantId: cardOrders.merchantId,
                    merchantName: cardMerchants.name,
                    merchantReference: cardOrders.merchantReference,
                    email: cardOrders.email,
                    productName: cardOrders.productName,
                    quantity: cardOrders.quantity,
                    amount: cardOrders.amount,
                    status: cardOrders.status,
                    commissionAmount: cardOrders.commissionAmount,
                    commissionState: cardOrders.commissionState,
                    commissionPayableAt: cardOrders.commissionPayableAt,
                    deliveredCount: cardOrders.deliveredCount,
                    paidAt: cardOrders.paidAt,
                    createdAt: cardOrders.createdAt,
                })
                .from(cardOrders)
                .innerJoin(cardMerchants, eq(cardMerchants.id, cardOrders.merchantId))
                .where(where)
                .orderBy(desc(cardOrders.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(cardOrders).where(where),
        ]);
        return { items, total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    async orderCodes(orderId: string) {
        const rows = await this.db.select({ code: cardOrderItems.code }).from(cardOrderItems).where(eq(cardOrderItems.orderId, orderId));
        return { items: rows };
    }

    private async salesByMerchant() {
        const rows = await this.db
            .select({
                merchantId: cardOrders.merchantId,
                orders: sql<number>`count(*) filter (where ${cardOrders.status} = 'paid')::int`,
                cards: sql<number>`coalesce(sum(${cardOrders.quantity}) filter (where ${cardOrders.status} = 'paid'), 0)::int`,
                grossSales: sql<string>`coalesce(sum(${cardOrders.amount}) filter (where ${cardOrders.status} = 'paid'), 0)::text`,
                commission: sql<string>`coalesce(sum(${cardOrders.commissionAmount}) filter (where ${cardOrders.status} = 'paid'), 0)::text`,
                refunded: sql<number>`count(*) filter (where ${cardOrders.commissionState} = 'reversed')::int`,
            })
            .from(cardOrders)
            .where(isNotNull(cardOrders.merchantId))
            .groupBy(cardOrders.merchantId);

        const map = new Map<string, { orders: number; cards: number; grossSales: string; commission: string; refunded: number }>();
        for (const row of rows) {
            if (row.merchantId) map.set(row.merchantId, row);
        }
        return map;
    }
}

function auditMerchant(row: {
    name: string;
    commissionMode: string;
    commissionRate: string;
    enabled: boolean;
    holdDays: number;
    dailySalesLimit: string;
    productScope: string[];
    returnUrls: string[];
}) {
    return {
        name: row.name,
        commissionMode: row.commissionMode,
        commissionRate: row.commissionRate,
        enabled: row.enabled,
        holdDays: row.holdDays,
        dailySalesLimit: row.dailySalesLimit,
        productScope: row.productScope,
        returnUrls: row.returnUrls,
    };
}
