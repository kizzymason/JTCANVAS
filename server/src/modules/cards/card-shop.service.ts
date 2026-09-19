import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { DB, type Database, type DbTransaction } from "../../db/db.module";
import { cardMerchants, cardOrderItems, cardOrders, cardProducts, redeemCardBatches, redeemCards } from "../../db/schema";
import { badRequest, notFound } from "../../common/errors";
import { formatMoney, money, mulMoney, toMoneyString } from "../../common/money";
import type { Paginated } from "../../common/types";
import { isPaymentMethod, type PaymentMethod } from "../payments/payment-gateway";
import { PaymentsService } from "../payments/payments.service";
import { MerchantCommissionService } from "./merchant-commission.service";
import { MerchantWebhookService } from "./merchant-webhook.service";
import { commissionPayableAt } from "./merchant.rules";
import { MerchantService, type ResolvedMerchant } from "./merchant.service";
import type { CardCheckoutDto, CardOrderLookupDto } from "./dto/card-shop.dto";

/** Callback paths, relative to the API prefix. Card orders settle separately from wallet top-ups. */
export const CARD_NOTIFY_PATH = "card-shop/notify";
export const CARD_RETURN_PATH = "card-shop/return";

type ProductRow = typeof cardProducts.$inferSelect;

/**
 * Card sales, both on our own storefront and through sales channels.
 *
 * Nothing here touches a wallet: a purchase hands over redeem codes, and the buyer credits their own
 * account later by redeeming them. That is what lets the whole flow run without an account, which is
 * the point of the page.
 *
 * Channel sales live in this service rather than beside it because they are the same sale: we set
 * the price, our payment channel collects, we deliver. The only difference is that a settled channel
 * order also accrues a commission.
 */
@Injectable()
export class CardShopService {
    private readonly logger = new Logger(CardShopService.name);

    constructor(
        @Inject(DB) private readonly db: Database,
        private readonly payments: PaymentsService,
        private readonly config: ConfigService,
        private readonly merchants: MerchantService,
        private readonly commission: MerchantCommissionService,
        private readonly webhooks: MerchantWebhookService,
    ) {}

    /** Storefront: enabled products with live stock, plus the payment methods actually usable. */
    async catalog() {
        const [products, methods] = await Promise.all([
            this.db.select().from(cardProducts).where(eq(cardProducts.enabled, true)).orderBy(asc(cardProducts.sortOrder), asc(cardProducts.createdAt)),
            this.payments.publicMethods(),
        ]);
        const stock = await this.stockByProduct(products.map((item) => item.id));
        const items = products.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            faceValue: item.faceValue,
            salePrice: item.salePrice,
            perOrderLimit: item.perOrderLimit,
            stock: stock.get(item.id) ?? 0,
        }));
        return { items, methods, available: methods.length > 0 && items.some((item) => item.stock > 0) };
    }

    async createOrder(params: { body: CardCheckoutDto; clientIp: string; userAgent: string }) {
        const method = params.body.method;
        if (!isPaymentMethod(method)) throw badRequest("PAYMENT_METHOD_INVALID", "不支持的支付方式");

        const email = normalizeEmail(params.body.email);
        const product = await this.requireEnabledProduct(params.body.productId);
        const quantity = Math.floor(params.body.quantity);
        if (quantity > product.perOrderLimit) throw badRequest("CARD_QUANTITY_LIMIT", `该商品单次最多购买 ${product.perOrderLimit} 张`);

        const stock = await this.stockFor(product.id);
        if (stock < quantity) throw badRequest("CARD_OUT_OF_STOCK", stock > 0 ? `库存不足，当前仅剩 ${stock} 张` : "该商品已售罄");

        const amount = toMoneyString(mulMoney(product.salePrice, quantity));
        const productName = `${product.name} ×${quantity}`;
        // The order number is a timestamp plus four random bytes, which is far too little entropy to
        // be the only thing guarding someone else's cards. This token is what actually gates them.
        const accessToken = randomBytes(32).toString("base64url");
        const [order] = await this.db
            .insert(cardOrders)
            .values({
                orderNo: createCardOrderNo(),
                email,
                productId: product.id,
                productName: product.name,
                faceValue: product.faceValue,
                unitPrice: product.salePrice,
                quantity,
                amount,
                paymentProvider: method,
                clientIp: params.clientIp,
                accessTokenHash: hashToken(accessToken),
            })
            .returning();

        try {
            const checkout = await this.openGateway(order, { method, label: productName, channelId: params.body.channelId, userAgent: params.userAgent });
            await this.db
                .update(cardOrders)
                .set({ metadata: { channelId: checkout.channelId, driver: checkout.driver, method }, updatedAt: new Date() })
                .where(eq(cardOrders.id, order.id));
            return {
                orderNo: order.orderNo,
                // Returned once, held by the buyer's browser; required to read the codes later.
                accessToken,
                amount: order.amount,
                quantity,
                method,
                payUrl: checkout.payUrl,
                qrcode: checkout.qrcode,
                img: checkout.img,
            };
        } catch (error) {
            // A checkout that never opened is not a real order; drop it so the list stays meaningful.
            await this.db.delete(cardOrders).where(eq(cardOrders.id, order.id));
            throw error;
        }
    }

    /** Payment methods a channel may offer. Shared with the storefront so the two cannot drift. */
    paymentMethods() {
        return this.payments.publicMethods();
    }

    /**
     * Opens a checkout on behalf of a sales channel.
     *
     * Everything that matters is decided here rather than by the caller: the price comes from our
     * product table, the payment goes through our own channel under our own merchant id, and the
     * commission is snapshotted from the terms in force right now. The channel supplies only what it
     * legitimately knows — which product, how many, who the buyer is, and its own order id.
     */
    async createChannelOrder(params: {
        merchant: ResolvedMerchant;
        product: ProductRow;
        quantity: number;
        unitPrice: string;
        amount: string;
        email: string;
        reference: string;
        method: string;
        returnUrl: string;
        clientIp: string;
        userAgent: string;
    }) {
        const method = params.method;
        if (!isPaymentMethod(method)) throw badRequest("PAYMENT_METHOD_INVALID", "不支持的支付方式");

        const accessToken = randomBytes(32).toString("base64url");
        const commissionAmount = this.merchantCommissionFor(params.merchant, params.amount, params.quantity);
        const [order] = await this.db
            .insert(cardOrders)
            .values({
                orderNo: createCardOrderNo(),
                email: normalizeEmail(params.email),
                productId: params.product.id,
                productName: params.product.name,
                faceValue: params.product.faceValue,
                unitPrice: params.unitPrice,
                quantity: params.quantity,
                amount: params.amount,
                paymentProvider: method,
                clientIp: params.clientIp,
                accessTokenHash: hashToken(accessToken),
                merchantId: params.merchant.id,
                merchantReference: params.reference.trim(),
                commissionRate: params.merchant.commissionRate,
                commissionAmount,
                commissionState: "pending",
            })
            .returning();

        try {
            const checkout = await this.openGateway(order, {
                method,
                label: this.merchants.checkoutLabelFor(params.merchant, `${params.product.name} ×${params.quantity}`),
                channelId: params.merchant.preferredChannelId ?? undefined,
                userAgent: params.userAgent,
            });
            await this.db
                .update(cardOrders)
                .set({
                    metadata: { channelId: checkout.channelId, driver: checkout.driver, method, returnUrl: params.returnUrl },
                    updatedAt: new Date(),
                })
                .where(eq(cardOrders.id, order.id));
            return {
                orderNo: order.orderNo,
                /** Scoped to this one order, safe to hand to the buyer's browser for polling. */
                accessToken,
                amount: order.amount,
                unitPrice: order.unitPrice,
                quantity: order.quantity,
                faceValue: order.faceValue,
                method,
                commission: commissionAmount,
                payUrl: checkout.payUrl,
                qrcode: checkout.qrcode,
                img: checkout.img,
            };
        } catch (error) {
            await this.db.delete(cardOrders).where(eq(cardOrders.id, order.id));
            throw error;
        }
    }

    /**
     * Answers a replayed checkout request. An unpaid order gets a fresh payment handle so the buyer
     * can still pay; a paid one comes back with its codes. Either way no second order is created and
     * the buyer cannot be charged twice.
     */
    async resumeChannelCheckout(order: typeof cardOrders.$inferSelect) {
        const base = {
            orderNo: order.orderNo,
            accessToken: "",
            amount: order.amount,
            unitPrice: order.unitPrice,
            quantity: order.quantity,
            faceValue: order.faceValue,
            method: order.paymentProvider,
            commission: order.commissionAmount,
            replayed: true as const,
        };
        if (order.status !== "pending") return { ...base, payUrl: "", qrcode: "", img: "" };
        try {
            const method = isPaymentMethod(order.paymentProvider) ? order.paymentProvider : "alipay";
            const checkout = await this.openGateway(order, {
                method,
                label: order.productName,
                channelId: channelIdOf(order) || undefined,
                userAgent: "",
            });
            return { ...base, payUrl: checkout.payUrl, qrcode: checkout.qrcode, img: checkout.img };
        } catch (error) {
            this.logger.warn(`checkout replay could not reopen payment: ${error instanceof Error ? error.message : "unknown"}`);
            return { ...base, payUrl: "", qrcode: "", img: "" };
        }
    }

    /** Asks the gateway about a pending order; used when a notification never arrived. */
    async trySettle(orderNo: string) {
        await this.trySettleFromGateway(await this.requireOrder(orderNo));
    }

    /**
     * Single order view for the buyer. Pending orders are re-checked against the gateway first, so a
     * lost notification cannot leave a paid order undelivered.
     *
     * Codes are only included when the caller presents the access token minted at checkout. Without
     * it the response still shows status and amount — enough to poll a payment — but no codes, so a
     * guessed order number is worthless. The e-mail look-up remains the recovery path.
     */
    async getOrder(orderNo: string, accessToken?: string) {
        let order = await this.requireOrder(orderNo);
        if (order.status === "pending") {
            await this.trySettleFromGateway(order);
            order = await this.requireOrder(orderNo);
        }
        const authorized = this.tokenMatches(order, accessToken);
        return this.publicOrder(order, authorized ? await this.itemsFor(order.id) : [], authorized);
    }

    /** Constant-time compare so a wrong token cannot be narrowed down by timing. */
    private tokenMatches(order: typeof cardOrders.$inferSelect, accessToken?: string) {
        const provided = (accessToken ?? "").trim();
        if (!provided || !order.accessTokenHash) return false;
        const expected = Buffer.from(order.accessTokenHash);
        const actual = Buffer.from(hashToken(provided));
        if (expected.length !== actual.length) return false;
        return timingSafeEqual(expected, actual);
    }

    /** The e-mail from checkout is the only credential the buyer has, so it is what look-up uses. */
    async listOrdersByEmail(query: CardOrderLookupDto): Promise<Paginated<Record<string, unknown>>> {
        const email = normalizeEmail(query.email);
        const where = eq(cardOrders.email, email);
        const [rows, [counted]] = await Promise.all([
            this.db
                .select()
                .from(cardOrders)
                .where(where)
                .orderBy(desc(cardOrders.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(cardOrders).where(where),
        ]);

        // Settle any still-pending order on the page before answering, for the same reason as above.
        for (const row of rows.filter((item) => item.status === "pending")) await this.trySettleFromGateway(row);
        const refreshed = rows.length
            ? await this.db
                  .select()
                  .from(cardOrders)
                  .where(inArray(cardOrders.id, rows.map((row) => row.id)))
                  .orderBy(desc(cardOrders.createdAt))
            : [];

        // Proving control of the e-mail used at checkout is itself the authorisation here, so the
        // codes come back without a token — this is the recovery path for a lost one.
        const items = await Promise.all(refreshed.map(async (row) => this.publicOrder(row, await this.itemsFor(row.id), true)));
        return { items, total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    /** Gateway notification. Must answer `success` for both the first delivery and any duplicate. */
    async handleNotify(params: Record<string, string>): Promise<"success" | "fail"> {
        try {
            const orderNo = params.out_trade_no?.trim();
            if (!orderNo) throw badRequest("PAYMENT_NOTIFY_INVALID", "缺少商户订单号");
            const order = await this.requireOrder(orderNo);
            await this.payments.verifyExternalNotify(params, channelIdOf(order));
            await this.markPaidAndDeliver(order.orderNo, params.money || order.amount, params.trade_no ?? "");
            return "success";
        } catch (error) {
            this.logger.warn(`card notify rejected: ${error instanceof Error ? error.message : "unknown"}`);
            return "fail";
        }
    }

    /**
     * Opens a payment at the gateway for an order that already exists.
     *
     * The `notify_url` and `return_url` we hand over always live on our own domain. That is not an
     * oversight for channel sales: the gateway is our merchant account, and a callback pointing at
     * someone else's domain is exactly the mismatch that gets an account reviewed. Sending the buyer
     * onward to the channel's page happens afterwards, in `handleReturn`.
     */
    private async openGateway(order: typeof cardOrders.$inferSelect, options: { method: PaymentMethod; label: string; channelId?: string; userAgent: string }) {
        return this.payments.createExternalCheckout({
            orderNo: order.orderNo,
            amount: order.amount,
            productName: options.label,
            method: options.method,
            notifyPath: CARD_NOTIFY_PATH,
            returnPath: CARD_RETURN_PATH,
            clientIp: order.clientIp,
            userAgent: options.userAgent,
            channelId: options.channelId,
        });
    }

    /**
     * Where the gateway sends the buyer back to after paying.
     *
     * For a channel sale this is the channel's own page, so the buyer never sees our domain. The
     * target is read from the order — which was written from the channel's admin-approved allowlist
     * at checkout — and never from the callback's query string, because the gateway's return is an
     * unauthenticated redirect that anyone could craft.
     */
    returnUrl(order?: typeof cardOrders.$inferSelect) {
        const orderNo = order?.orderNo ?? "";
        const query = orderNo ? `?order=${encodeURIComponent(orderNo)}` : "";
        const downstream = typeof order?.metadata?.returnUrl === "string" ? order.metadata.returnUrl : "";
        if (downstream) {
            return `${downstream}${downstream.includes("?") ? "&" : "?"}order=${encodeURIComponent(orderNo)}`;
        }
        const origin = this.config.get<string>("publicUrl") || "";
        return `${origin}/cards/orders${query}`;
    }

    async handleReturn(params: Record<string, string>) {
        const orderNo = params.out_trade_no?.trim() ?? "";
        let order: typeof cardOrders.$inferSelect | undefined;
        try {
            if (orderNo) {
                order = await this.requireOrder(orderNo);
                await this.payments.verifyExternalNotify(params, channelIdOf(order));
                await this.markPaidAndDeliver(order.orderNo, params.money || order.amount, params.trade_no ?? "");
            }
        } catch (error) {
            this.logger.warn(`card return ignored: ${error instanceof Error ? error.message : "unknown"}`);
        }
        return this.returnUrl(order);
    }

    /**
     * Flips the order to paid and hands over codes in one transaction.
     *
     * Cards are claimed with `FOR UPDATE SKIP LOCKED` so two concurrent deliveries never fight over
     * the same row, and `card_order_items.card_id` is unique, which makes selling one card twice
     * impossible even if this method were entered twice for different orders.
     */
    async markPaidAndDeliver(orderNo: string, paidAmount: string, providerTxnId: string) {
        const result = await this.settleOrder(orderNo, paidAmount, providerTxnId);
        // Told after the transaction commits, and never awaited: a channel's endpoint being slow or
        // down must not delay the buyer's codes or put the payment at risk of rollback.
        if (!result.alreadyPaid && result.channelOrderId) {
            void this.webhooks.notifyOrderPaid(result.channelOrderId).catch(() => undefined);
        }
        return result;
    }

    private async settleOrder(orderNo: string, paidAmount: string, providerTxnId: string) {
        return this.db.transaction(async (tx) => {
            const [order] = await tx.select().from(cardOrders).where(eq(cardOrders.orderNo, orderNo)).for("update").limit(1);
            if (!order) throw notFound("订单不存在");
            if (order.status === "paid") return { alreadyPaid: true as const, delivered: order.deliveredCount, channelOrderId: "" };
            if (order.status !== "pending") throw badRequest("CARD_ORDER_NOT_PAYABLE", "订单状态不可支付");
            if (formatMoney(order.amount) !== formatMoney(paidAmount)) throw badRequest("CARD_ORDER_AMOUNT_MISMATCH", "支付金额与订单不符");

            const claimed = order.productId ? await this.claimCards(tx, order.productId, order.quantity) : [];
            if (claimed.length) {
                await tx.insert(cardOrderItems).values(claimed.map((card) => ({ orderId: order.id, cardId: card.id, code: card.code })));
            }
            if (claimed.length < order.quantity) {
                // Paid but short: never silently keep the money without saying so. The order stays
                // visible with what was delivered so an admin can top up stock or refund.
                this.logger.error(`card order ${orderNo} delivered ${claimed.length}/${order.quantity}: stock ran out after payment`);
            }

            const paidAt = new Date();
            await tx
                .update(cardOrders)
                .set({
                    status: "paid",
                    providerTxnId: providerTxnId || order.providerTxnId,
                    paidAt,
                    deliveredCount: claimed.length,
                    updatedAt: paidAt,
                })
                .where(eq(cardOrders.id, order.id));

            /*
             * Commission is earned by a settled payment, so it is recorded in the same transaction:
             * a sale that commits without its accrual, or an accrual without its sale, would both be
             * wrong. The unique index on `(order_id, type)` means a replayed notification cannot pay
             * the channel twice even if it somehow got past the status check above.
             */
            if (order.merchantId && money(order.commissionAmount).gt(0)) {
                const payableAt = commissionPayableAt(paidAt, await this.holdDaysFor(tx, order.merchantId));
                await this.commission.accrue(tx, {
                    merchantId: order.merchantId,
                    orderId: order.id,
                    amount: order.commissionAmount,
                    note: `订单 ${order.orderNo} 成交计提佣金`,
                });
                await tx.update(cardOrders).set({ commissionState: "accrued", commissionPayableAt: payableAt }).where(eq(cardOrders.id, order.id));
            }

            return { alreadyPaid: false as const, delivered: claimed.length, channelOrderId: order.merchantId ? order.id : "" };
        });
    }

    private async holdDaysFor(tx: DbTransaction, merchantId: string) {
        const [row] = await tx.select({ holdDays: cardMerchants.holdDays }).from(cardMerchants).where(eq(cardMerchants.id, merchantId)).limit(1);
        return row?.holdDays ?? 0;
    }

    private merchantCommissionFor(merchant: ResolvedMerchant, amount: string, quantity: number) {
        return this.merchants.commissionFor(merchant, { amount, quantity });
    }

    /**
     * Cards still available against a product: unused, unexpired and not already sold.
     *
     * Every sale — our own storefront and every channel — lands in `card_order_items`, so this one
     * anti-join covers all of them, and the unique constraint on `card_order_items.card_id` is what
     * makes selling a card twice impossible no matter which path delivered it.
     */
    sellableCardCondition(productId: string) {
        const soldCardIds = this.db.select({ id: cardOrderItems.cardId }).from(cardOrderItems).where(sql`${cardOrderItems.cardId} is not null`);
        return and(
            eq(redeemCardBatches.productId, productId),
            eq(redeemCards.status, "unused"),
            sql`(${redeemCards.expiresAt} is null or ${redeemCards.expiresAt} > now())`,
            notInArray(redeemCards.id, soldCardIds),
        );
    }

    /**
     * `OF redeem_cards` is essential: without it the lock covers the joined batch row too, and since
     * a whole batch is usually one row, the first concurrent buyer would lock it and every other
     * checkout would skip every card in that batch — reporting "out of stock" while stock exists.
     */
    private async claimCards(tx: DbTransaction, productId: string, quantity: number) {
        const rows = await tx
            .select({ id: redeemCards.id, code: redeemCards.code })
            .from(redeemCards)
            .innerJoin(redeemCardBatches, eq(redeemCardBatches.id, redeemCards.batchId))
            .where(this.sellableCardCondition(productId))
            .orderBy(asc(redeemCards.createdAt))
            .limit(quantity)
            .for("update", { of: redeemCards, skipLocked: true });
        return rows;
    }

    async stockFor(productId: string) {
        const [row] = await this.db
            .select({ total: sql<number>`count(*)::int` })
            .from(redeemCards)
            .innerJoin(redeemCardBatches, eq(redeemCardBatches.id, redeemCards.batchId))
            .where(this.sellableCardCondition(productId));
        return row?.total ?? 0;
    }

    async stockByProduct(productIds: string[]) {
        const stock = new Map<string, number>();
        if (!productIds.length) return stock;
        const soldCardIds = this.db.select({ id: cardOrderItems.cardId }).from(cardOrderItems).where(sql`${cardOrderItems.cardId} is not null`);
        const rows = await this.db
            .select({ productId: redeemCardBatches.productId, total: sql<number>`count(*)::int` })
            .from(redeemCards)
            .innerJoin(redeemCardBatches, eq(redeemCardBatches.id, redeemCards.batchId))
            .where(
                and(
                    inArray(redeemCardBatches.productId, productIds),
                    eq(redeemCards.status, "unused"),
                    sql`(${redeemCards.expiresAt} is null or ${redeemCards.expiresAt} > now())`,
                    notInArray(redeemCards.id, soldCardIds),
                ),
            )
            .groupBy(redeemCardBatches.productId);
        for (const row of rows) if (row.productId) stock.set(row.productId, row.total);
        return stock;
    }

    private async trySettleFromGateway(order: typeof cardOrders.$inferSelect) {
        const channelId = channelIdOf(order);
        if (!channelId) return;
        try {
            const queried = await this.payments.queryExternalOrder(order.orderNo, channelId);
            if (!queried.paid) return;
            await this.markPaidAndDeliver(order.orderNo, queried.money || order.amount, queried.tradeNo ?? "");
        } catch (error) {
            this.logger.warn(`card order query skipped: ${error instanceof Error ? error.message : "unknown"}`);
        }
    }

    private async itemsFor(orderId: string) {
        return this.db.select({ code: cardOrderItems.code }).from(cardOrderItems).where(eq(cardOrderItems.orderId, orderId)).orderBy(asc(cardOrderItems.createdAt));
    }

    private publicOrder(order: typeof cardOrders.$inferSelect, items: Array<{ code: string }>, authorized = false) {
        return {
            orderNo: order.orderNo,
            email: maskEmail(order.email),
            productName: order.productName,
            faceValue: order.faceValue,
            unitPrice: order.unitPrice,
            quantity: order.quantity,
            amount: order.amount,
            status: order.status,
            method: order.paymentProvider,
            paidAt: order.paidAt,
            createdAt: order.createdAt,
            deliveredCount: order.deliveredCount,
            // Codes need both a settled payment and proof the caller owns the order.
            codes: order.status === "paid" && authorized ? items.map((item) => item.code) : [],
            /** Lets the page tell "not paid yet" apart from "paid, but you did not prove ownership". */
            codesLocked: order.status === "paid" && !authorized,
        };
    }

    private async requireOrder(orderNo: string) {
        const [order] = await this.db.select().from(cardOrders).where(eq(cardOrders.orderNo, orderNo.trim())).limit(1);
        if (!order) throw notFound("订单不存在");
        return order;
    }

    private async requireEnabledProduct(productId: string): Promise<ProductRow> {
        const [product] = await this.db
            .select()
            .from(cardProducts)
            .where(and(eq(cardProducts.id, productId), eq(cardProducts.enabled, true)))
            .limit(1);
        if (!product) throw notFound("商品不存在或已下架");
        return product;
    }
}

export function normalizeEmail(email: string) {
    return email.trim().toLowerCase();
}

/** Only the hash is stored, so a database leak cannot be replayed to read someone's cards. */
export function hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
}

/** Shown back to the buyer so they can confirm which address they used without exposing it fully. */
export function maskEmail(email: string) {
    const [name, domain] = email.split("@");
    if (!domain) return email;
    const head = name.slice(0, 2);
    return `${head}${name.length > 2 ? "***" : ""}@${domain}`;
}

/** `C` prefix keeps card orders visually distinct from wallet order numbers in gateway dashboards. */
export function createCardOrderNo() {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    return `C${stamp}${randomBytes(4).toString("hex").toUpperCase()}`;
}

function channelIdOf(order: typeof cardOrders.$inferSelect) {
    return typeof order.metadata.channelId === "string" ? order.metadata.channelId : "";
}
