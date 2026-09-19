import { randomInt } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { DB, type Database } from "../../db/db.module";
import { cardOrderItems, cardOrders, cardProducts, redeemCardBatches, redeemCards } from "../../db/schema";
import { badRequest, conflict, notFound } from "../../common/errors";
import { gte, toMoneyString } from "../../common/money";
import type { Paginated } from "../../common/types";
import { CardShopService } from "./card-shop.service";
import type { AdminCardOrderQueryDto, GenerateProductCardsDto, ImportProductCardsDto, SettleCardOrderDto, UpsertCardProductDto } from "./dto/card-shop.dto";

/** Same alphabet the wallet's own card minting uses, so generated codes look consistent. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const MAX_IMPORT = 5000;

type ProductRow = typeof cardProducts.$inferSelect;

/** Admin side of the card shop: products, stocking them, and reading the resulting orders. */
@Injectable()
export class CardShopAdminService {
    constructor(
        @Inject(DB) private readonly db: Database,
        private readonly shop: CardShopService,
    ) {}

    async listProducts() {
        const rows = await this.db.select().from(cardProducts).orderBy(asc(cardProducts.sortOrder), asc(cardProducts.createdAt));
        const stock = await this.shop.stockByProduct(rows.map((row) => row.id));
        const sold = await this.soldByProduct();
        return {
            items: rows.map((row) => ({
                ...row,
                stock: stock.get(row.id) ?? 0,
                soldCount: sold.get(row.id) ?? 0,
            })),
        };
    }

    async createProduct(input: UpsertCardProductDto) {
        this.assertPrices(input);
        const [created] = await this.db
            .insert(cardProducts)
            .values({
                name: input.name.trim(),
                description: input.description?.trim() ?? "",
                faceValue: toMoneyString(input.faceValue),
                salePrice: toMoneyString(input.salePrice),
                perOrderLimit: input.perOrderLimit ?? 10,
                enabled: input.enabled ?? true,
                sortOrder: input.sortOrder ?? 100,
            })
            .returning();
        return { product: created, audit: { targetId: created.id, after: auditProduct(created) } };
    }

    async updateProduct(id: string, input: UpsertCardProductDto) {
        this.assertPrices(input);
        const before = await this.requireProduct(id);
        const [after] = await this.db
            .update(cardProducts)
            .set({
                name: input.name.trim(),
                description: input.description?.trim() ?? "",
                faceValue: toMoneyString(input.faceValue),
                salePrice: toMoneyString(input.salePrice),
                perOrderLimit: input.perOrderLimit ?? before.perOrderLimit,
                enabled: input.enabled ?? before.enabled,
                sortOrder: input.sortOrder ?? before.sortOrder,
                updatedAt: new Date(),
            })
            .where(eq(cardProducts.id, id))
            .returning();
        return { product: after, audit: { targetId: id, before: auditProduct(before), after: auditProduct(after) } };
    }

    /**
     * Products are only removable while nothing depends on them: an order references the product for
     * reporting, and stocked batches would otherwise be left pointing at nothing.
     */
    async deleteProduct(id: string) {
        const before = await this.requireProduct(id);
        const [orderCount] = await this.db.select({ total: sql<number>`count(*)::int` }).from(cardOrders).where(eq(cardOrders.productId, id));
        if ((orderCount?.total ?? 0) > 0) throw conflict("CARD_PRODUCT_IN_USE", "该商品已产生订单，不能删除，请改为下架");
        const [batchCount] = await this.db.select({ total: sql<number>`count(*)::int` }).from(redeemCardBatches).where(eq(redeemCardBatches.productId, id));
        if ((batchCount?.total ?? 0) > 0) throw conflict("CARD_PRODUCT_HAS_STOCK", "该商品仍有导入的卡密批次，请先处理库存");
        await this.db.delete(cardProducts).where(eq(cardProducts.id, id));
        return { id, audit: { targetId: id, before: auditProduct(before) } };
    }

    /** Mints fresh codes straight into a product's stock. */
    async generateCards(productId: string, input: GenerateProductCardsDto, createdBy: string) {
        const product = await this.requireProduct(productId);
        const expiresAt = parseExpiry(input.expiresAt);
        const codes = new Set<string>();
        while (codes.size < input.quantity) codes.add(generateCode());
        const result = await this.stock(product, [...codes], input.batchName, expiresAt, createdBy);
        return { ...result, audit: { targetId: productId, after: { productId, generated: result.inserted, batchId: result.batchId } } };
    }

    /**
     * Imports codes an admin already has (bought elsewhere, or minted by hand). Duplicates against
     * existing cards are reported rather than silently dropped, because a duplicate usually means the
     * same file was imported twice and the admin needs to know the stock did not grow.
     */
    async importCards(productId: string, input: ImportProductCardsDto, createdBy: string) {
        const product = await this.requireProduct(productId);
        const parsed = parseCodes(input.codes);
        if (!parsed.codes.length) throw badRequest("CARD_CODES_REQUIRED", "请粘贴至少一个卡密");
        if (parsed.codes.length > MAX_IMPORT) throw badRequest("CARD_CODES_TOO_MANY", `单次最多导入 ${MAX_IMPORT} 个卡密`);

        const expiresAt = parseExpiry(input.expiresAt);
        const result = await this.stock(product, parsed.codes, input.batchName, expiresAt, createdBy);
        return {
            ...result,
            duplicatedInInput: parsed.duplicates,
            skipped: parsed.codes.length - result.inserted,
            audit: { targetId: productId, after: { productId, imported: result.inserted, skipped: parsed.codes.length - result.inserted, batchId: result.batchId } },
        };
    }

    async listOrders(query: AdminCardOrderQueryDto): Promise<Paginated<Record<string, unknown>>> {
        const filters = [
            query.status ? eq(cardOrders.status, query.status) : undefined,
            query.productId ? eq(cardOrders.productId, query.productId) : undefined,
            query.keyword?.trim() ? or(ilike(cardOrders.email, `%${query.keyword.trim()}%`), ilike(cardOrders.orderNo, `%${query.keyword.trim()}%`)) : undefined,
        ].filter(Boolean);
        const where = filters.length ? and(...filters) : undefined;

        const [items, [counted], [totals]] = await Promise.all([
            this.db
                .select({
                    id: cardOrders.id,
                    orderNo: cardOrders.orderNo,
                    email: cardOrders.email,
                    productName: cardOrders.productName,
                    faceValue: cardOrders.faceValue,
                    unitPrice: cardOrders.unitPrice,
                    quantity: cardOrders.quantity,
                    amount: cardOrders.amount,
                    status: cardOrders.status,
                    method: cardOrders.paymentProvider,
                    deliveredCount: cardOrders.deliveredCount,
                    providerTxnId: cardOrders.providerTxnId,
                    clientIp: cardOrders.clientIp,
                    paidAt: cardOrders.paidAt,
                    createdAt: cardOrders.createdAt,
                })
                .from(cardOrders)
                .where(where)
                .orderBy(desc(cardOrders.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(cardOrders).where(where),
            this.db
                .select({
                    paidOrders: sql<number>`count(*) filter (where ${cardOrders.status} = 'paid')::int`,
                    revenue: sql<string>`coalesce(sum(${cardOrders.amount}) filter (where ${cardOrders.status} = 'paid'), 0)::text`,
                    undelivered: sql<number>`count(*) filter (where ${cardOrders.status} = 'paid' and ${cardOrders.deliveredCount} < ${cardOrders.quantity})::int`,
                })
                .from(cardOrders)
                .where(where),
        ]);

        return {
            items: items.map((item) => ({ ...item, totals })),
            total: counted?.total ?? 0,
            page: query.page,
            pageSize: query.pageSize,
        };
    }

    /** Codes an order handed over, for support requests. */
    async orderCodes(orderId: string) {
        const rows = await this.db.select({ code: cardOrderItems.code }).from(cardOrderItems).where(eq(cardOrderItems.orderId, orderId)).orderBy(asc(cardOrderItems.createdAt));
        return { codes: rows.map((row) => row.code) };
    }

    /**
     * Confirms payment by hand and delivers the codes.
     *
     * For the cases the gateway cannot cover: a notification that never arrived, or money taken
     * offline. It goes through the same `markPaidAndDeliver` path as a real callback, so the amount
     * check, the stock claim and the channel commission all behave identically — the only difference
     * is that a human vouched for the money instead of the gateway's signature. Audited for exactly
     * that reason.
     */
    async settleOrder(input: SettleCardOrderDto) {
        const result = await this.shop.markPaidAndDeliver(input.orderNo.trim(), toMoneyString(input.amount), input.providerTxnId ?? "manual");
        return {
            orderNo: input.orderNo.trim(),
            alreadyPaid: result.alreadyPaid,
            delivered: result.delivered,
            audit: { targetId: input.orderNo.trim(), after: { amount: input.amount, providerTxnId: input.providerTxnId ?? "manual", delivered: result.delivered } },
        };
    }

    /** One batch per stocking action keeps the existing card admin pages meaningful. */
    private async stock(product: ProductRow, codes: string[], batchName: string | undefined, expiresAt: Date | null, createdBy: string) {
        const faceValue = product.faceValue;
        return this.db.transaction(async (tx) => {
            const [batch] = await tx
                .insert(redeemCardBatches)
                .values({
                    name: batchName?.trim() || product.name,
                    faceValue,
                    quantity: codes.length,
                    productId: product.id,
                    expiresAt,
                    createdBy,
                })
                .returning();

            // `onConflictDoNothing` on the unique code index makes a repeated import a no-op.
            const inserted = await tx
                .insert(redeemCards)
                .values(codes.map((code) => ({ batchId: batch.id, code, faceValue, expiresAt })))
                .onConflictDoNothing()
                .returning({ id: redeemCards.id });

            if (inserted.length !== codes.length) {
                await tx.update(redeemCardBatches).set({ quantity: inserted.length }).where(eq(redeemCardBatches.id, batch.id));
            }
            return { batchId: batch.id, inserted: inserted.length, requested: codes.length };
        });
    }

    private async soldByProduct() {
        const rows = await this.db
            .select({ productId: cardOrders.productId, total: sql<number>`count(${cardOrderItems.id})::int` })
            .from(cardOrderItems)
            .innerJoin(cardOrders, eq(cardOrders.id, cardOrderItems.orderId))
            .groupBy(cardOrders.productId);
        const sold = new Map<string, number>();
        for (const row of rows) if (row.productId) sold.set(row.productId, row.total);
        return sold;
    }

    private async requireProduct(id: string) {
        const [row] = await this.db.select().from(cardProducts).where(eq(cardProducts.id, id)).limit(1);
        if (!row) throw notFound("商品不存在");
        return row;
    }

    private assertPrices(input: UpsertCardProductDto) {
        const face = toMoneyString(input.faceValue);
        const sale = toMoneyString(input.salePrice);
        if (!gte(face, "0.01") || !gte(sale, "0.01")) throw badRequest("CARD_PRICE_INVALID", "面值与售价必须大于 0");
        if (!gte("100000.000000", face) || !gte("100000.000000", sale)) throw badRequest("CARD_PRICE_INVALID", "金额不能超过 100000 元");
    }
}

/** Accepts one code per line, and tolerates comma or semicolon separated pastes. */
export function parseCodes(raw: string) {
    const seen = new Set<string>();
    let duplicates = 0;
    for (const part of raw.split(/[\s,;]+/)) {
        const code = part.trim().toUpperCase();
        if (!code) continue;
        if (seen.has(code)) {
            duplicates += 1;
            continue;
        }
        seen.add(code);
    }
    return { codes: [...seen], duplicates };
}

function parseExpiry(value: string | undefined) {
    if (!value?.trim()) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw badRequest("CARD_EXPIRY_INVALID", "过期时间格式不正确");
    return date;
}

function generateCode() {
    const groups: string[] = [];
    for (let group = 0; group < 4; group += 1) {
        let chunk = "";
        for (let index = 0; index < 4; index += 1) chunk += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
        groups.push(chunk);
    }
    return groups.join("-");
}

function auditProduct(row: ProductRow) {
    return { name: row.name, faceValue: row.faceValue, salePrice: row.salePrice, perOrderLimit: row.perOrderLimit, enabled: row.enabled, sortOrder: row.sortOrder };
}
