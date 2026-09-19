import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DB, type Database } from "../../db/db.module";
import { cardOrderItems, cardOrders, cardProducts } from "../../db/schema";
import { isUniqueViolation } from "../../common/db-errors";
import { badRequest, forbidden, notFound } from "../../common/errors";
import { formatMoney, mulMoney, toMoneyString } from "../../common/money";
import type { Paginated } from "../../common/types";
import { CardShopService } from "./card-shop.service";
import { MerchantCommissionService } from "./merchant-commission.service";
import { fitsDailyLimit } from "./merchant.rules";
import { MerchantService, type ResolvedMerchant } from "./merchant.service";
import type { CardChannelOrderQueryDto, CreateChannelCheckoutDto } from "./dto/card-dist.dto";

/**
 * The channel sales API: a hosted checkout that downstream sites drive from their own UI.
 *
 * The channel asks us to open a checkout; we price it from our own product table, put it through our
 * own payment channel, take the money into our own account, deliver the codes ourselves, and credit
 * the channel a commission once the payment has settled. The channel never holds stock, never sees a
 * payment credential and never states an amount — which is exactly what keeps us the merchant of
 * record and keeps the payout a service fee rather than a settlement of someone else's funds.
 */
@Injectable()
export class CardDistService {
    private readonly logger = new Logger(CardDistService.name);

    constructor(
        @Inject(DB) private readonly db: Database,
        private readonly merchants: MerchantService,
        private readonly commission: MerchantCommissionService,
        private readonly shop: CardShopService,
    ) {}

    /** Catalogue for a channel: what it may sell, at our price, with live stock. */
    async products(merchant: ResolvedMerchant) {
        const rows = await this.merchants.scopedProducts(merchant);
        const stock = await this.shop.stockByProduct(rows.map((row) => row.id));
        return {
            items: await Promise.all(
                rows.map(async (row) => {
                    const price = await this.merchants.retailPriceFor(merchant.id, row);
                    return {
                        id: row.id,
                        name: row.name,
                        description: row.description,
                        faceValue: row.faceValue,
                        /** What the buyer will be charged. The channel displays it; it cannot change it. */
                        price,
                        perOrderLimit: row.perOrderLimit,
                        stock: stock.get(row.id) ?? 0,
                        estimatedCommission: this.merchants.commissionFor(merchant, { amount: price, quantity: 1 }),
                    };
                }),
            ),
            methods: await this.shop.paymentMethods(),
        };
    }

    /**
     * Opens a checkout for a buyer sitting on the channel's own page.
     *
     * `reference` is the channel's own order id and doubles as the idempotency key: the partial
     * unique index on `(merchant_id, merchant_reference)` means a retried request returns the
     * original checkout instead of opening a second one and charging the buyer twice.
     */
    async createCheckout(merchant: ResolvedMerchant, input: CreateChannelCheckoutDto, context: { clientIp: string; userAgent: string }) {
        const existing = await this.findByReference(merchant.id, input.reference);
        if (existing) return existing;

        this.merchants.assertProductAllowed(merchant, input.productId);
        const product = await this.requireProduct(input.productId);
        if (input.quantity > product.perOrderLimit) throw badRequest("CARD_QUANTITY_LIMIT", `该商品单次最多购买 ${product.perOrderLimit} 张`);

        const stock = await this.shop.stockFor(product.id);
        if (stock < input.quantity) throw badRequest("CARD_OUT_OF_STOCK", stock > 0 ? `库存不足，当前仅剩 ${stock} 张` : "该商品已售罄");

        const unitPrice = await this.merchants.retailPriceFor(merchant.id, product);
        const amount = toMoneyString(mulMoney(unitPrice, input.quantity));
        await this.assertWithinDailyLimit(merchant, amount);

        try {
            const created = await this.shop.createChannelOrder({
                merchant,
                product,
                quantity: input.quantity,
                unitPrice,
                amount,
                email: input.email,
                reference: input.reference,
                method: input.method,
                returnUrl: this.merchants.resolveReturnUrl(merchant, input.returnUrl),
                clientIp: context.clientIp,
                userAgent: context.userAgent,
            });
            void this.merchants.touch(merchant.id).catch(() => undefined);
            return created;
        } catch (error) {
            /*
             * A concurrent retry of the same reference lost the race on the unique index. The winner
             * already has the order, so replay it rather than surfacing an error: a downstream that
             * retries on a timeout must get its original checkout back, not a 500.
             */
            if (isUniqueViolation(error)) {
                const replay = await this.findByReference(merchant.id, input.reference);
                if (replay) return replay;
            }
            throw error;
        }
    }

    /** Status and, once paid, the codes. Scoped to the calling channel's own orders. */
    async checkout(merchant: ResolvedMerchant, orderNo: string) {
        const order = await this.requireOwnOrder(merchant.id, orderNo);
        if (order.status === "pending") {
            await this.shop.trySettle(order.orderNo);
            return this.toCheckoutView(await this.requireOwnOrder(merchant.id, orderNo));
        }
        return this.toCheckoutView(order);
    }

    async orders(merchant: ResolvedMerchant, query: CardChannelOrderQueryDto): Promise<Paginated<Record<string, unknown>>> {
        const conditions = [eq(cardOrders.merchantId, merchant.id)];
        if (query.status) conditions.push(eq(cardOrders.status, query.status));
        const where = and(...conditions);
        const [items, [counted]] = await Promise.all([
            this.db
                .select()
                .from(cardOrders)
                .where(where)
                .orderBy(desc(cardOrders.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(cardOrders).where(where),
        ]);
        return {
            items: items.map((order) => ({
                orderNo: order.orderNo,
                reference: order.merchantReference,
                productName: order.productName,
                quantity: order.quantity,
                amount: order.amount,
                status: order.status,
                commission: order.commissionAmount,
                commissionState: order.commissionState,
                paidAt: order.paidAt,
                createdAt: order.createdAt,
            })),
            total: counted?.total ?? 0,
            page: query.page,
            pageSize: query.pageSize,
        };
    }

    /** Sales and commission the channel can reconcile its own books against. */
    async stats(merchant: ResolvedMerchant) {
        const summary = await this.commission.summary(merchant.id);
        return {
            ...summary,
            commissionMode: merchant.commissionMode,
            commissionRate: merchant.commissionRate,
            holdDays: merchant.holdDays,
            dailySalesLimit: merchant.dailySalesLimit,
            soldToday: await this.soldToday(merchant.id),
        };
    }

    payouts(merchant: ResolvedMerchant, query: { page: number; pageSize: number }) {
        return this.commission.payouts(merchant.id, query);
    }

    /**
     * Refuses a checkout that would push this channel past its daily ceiling.
     *
     * This is the single most useful guard against a payment-provider review: what draws attention
     * is a merchant account whose daily volume jumps by an order of magnitude overnight, and a
     * per-channel cap is what keeps any one downstream from causing that.
     */
    private async assertWithinDailyLimit(merchant: ResolvedMerchant, amount: string) {
        const soldToday = await this.soldToday(merchant.id);
        if (fitsDailyLimit({ dailySalesLimit: merchant.dailySalesLimit, soldToday, amount })) return;
        throw forbidden(`该渠道今日销售额度已用尽：上限 ${formatMoney(merchant.dailySalesLimit)}，今日已占用 ${formatMoney(soldToday)}`);
    }

    /**
     * Today's settled sales, plus checkouts still awaiting payment. Pending orders count too: a
     * channel could otherwise open unlimited checkouts and let them all settle at once, sailing past
     * the ceiling the cap exists to hold.
     */
    private async soldToday(merchantId: string) {
        const [row] = await this.db
            .select({ total: sql<string>`coalesce(sum(${cardOrders.amount}), 0)::text` })
            .from(cardOrders)
            .where(
                and(
                    eq(cardOrders.merchantId, merchantId),
                    sql`${cardOrders.status} in ('paid', 'pending')`,
                    sql`${cardOrders.createdAt} >= date_trunc('day', now())`,
                ),
            );
        return toMoneyString(row?.total ?? 0);
    }

    private async findByReference(merchantId: string, reference: string) {
        const trimmed = reference.trim();
        if (!trimmed) return null;
        const [order] = await this.db
            .select()
            .from(cardOrders)
            .where(and(eq(cardOrders.merchantId, merchantId), eq(cardOrders.merchantReference, trimmed)))
            .limit(1);
        if (!order) return null;
        // A replay gets the original checkout back, including a fresh payment handle if still unpaid.
        return this.shop.resumeChannelCheckout(order);
    }

    private async requireOwnOrder(merchantId: string, orderNo: string) {
        const [order] = await this.db.select().from(cardOrders).where(eq(cardOrders.orderNo, orderNo.trim())).limit(1);
        // Same wording whether it never existed or belongs to another channel: a channel has no
        // business learning which order numbers are real.
        if (!order || order.merchantId !== merchantId) throw notFound("订单不存在");
        return order;
    }

    private async toCheckoutView(order: typeof cardOrders.$inferSelect) {
        const codes =
            order.status === "paid"
                ? (await this.db.select({ code: cardOrderItems.code }).from(cardOrderItems).where(eq(cardOrderItems.orderId, order.id))).map((row) => row.code)
                : [];
        return {
            orderNo: order.orderNo,
            reference: order.merchantReference,
            productName: order.productName,
            faceValue: order.faceValue,
            quantity: order.quantity,
            amount: order.amount,
            status: order.status,
            paidAt: order.paidAt,
            deliveredCount: order.deliveredCount,
            commission: order.commissionAmount,
            commissionState: order.commissionState,
            codes,
        };
    }

    private async requireProduct(productId: string) {
        const [product] = await this.db
            .select()
            .from(cardProducts)
            .where(and(eq(cardProducts.id, productId), eq(cardProducts.enabled, true)))
            .limit(1);
        if (!product) throw notFound("商品不存在或已下架");
        return product;
    }
}
