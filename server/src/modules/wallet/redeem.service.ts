import { randomInt } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { DB, type Database } from "../../db/db.module";
import { redeemCardBatches, redeemCards } from "../../db/schema";
import { badRequest, conflict, notFound } from "../../common/errors";
import { toMoneyString, type MoneyInput } from "../../common/money";
import type { Paginated } from "../../common/types";
import { WalletService } from "./wallet.service";

/** Ambiguous glyphs (0/O, 1/I/L) are excluded so codes survive being read aloud or retyped. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_GROUPS = 4;
const CODE_GROUP_SIZE = 4;

@Injectable()
export class RedeemService {
    constructor(
        @Inject(DB) private readonly db: Database,
        private readonly wallet: WalletService,
    ) {}

    /** Admin action: mint a batch of single-use cards at one face value. */
    async createBatch(params: { name: string; faceValue: MoneyInput; quantity: number; expiresAt?: Date; createdBy: string }) {
        if (params.quantity < 1 || params.quantity > 5000) throw badRequest("INVALID_QUANTITY", "单批数量需在 1 到 5000 之间");
        const faceValue = toMoneyString(params.faceValue);

        return this.db.transaction(async (tx) => {
            const [batch] = await tx
                .insert(redeemCardBatches)
                .values({ name: params.name, faceValue, quantity: params.quantity, expiresAt: params.expiresAt ?? null, createdBy: params.createdBy })
                .returning();

            // Generate then insert in one statement; the unique index on `code` is the collision guard.
            const rows = Array.from({ length: params.quantity }, () => ({
                batchId: batch.id,
                code: generateCode(),
                faceValue,
                expiresAt: params.expiresAt ?? null,
            }));
            const cards = await tx.insert(redeemCards).values(rows).returning({ id: redeemCards.id, code: redeemCards.code });
            return { batch, cards };
        });
    }

    /**
     * Consumes a card and credits the wallet. The status transition is guarded inside the UPDATE's
     * WHERE clause, so two concurrent redemptions of the same code cannot both succeed.
     */
    async redeem(params: { userId: string; code: string }) {
        const code = params.code.trim().toUpperCase().replace(/\s+/g, "");
        const [card] = await this.db.select().from(redeemCards).where(eq(redeemCards.code, code)).limit(1);
        if (!card) throw notFound("卡密不存在");
        if (card.status === "void") throw badRequest("CARD_VOID", "该卡密已作废");
        if (card.status === "used") throw conflict("CARD_USED", "该卡密已被使用");
        if (card.expiresAt && card.expiresAt.getTime() < Date.now()) throw badRequest("CARD_EXPIRED", "该卡密已过期");

        // Claim first: only the request that flips unused -> used may credit the wallet.
        const claimed = await this.db
            .update(redeemCards)
            .set({ status: "used", redeemedBy: params.userId, redeemedAt: new Date() })
            .where(and(eq(redeemCards.id, card.id), eq(redeemCards.status, "unused")))
            .returning({ id: redeemCards.id, faceValue: redeemCards.faceValue });
        if (!claimed.length) throw conflict("CARD_USED", "该卡密已被使用");

        try {
            const result = await this.wallet.credit({
                userId: params.userId,
                amount: claimed[0].faceValue,
                type: "redeem",
                paymentProvider: "card",
                cardId: card.id,
                note: `卡密兑换 ${maskCode(code)}`,
            });
            return { amount: claimed[0].faceValue, balance: result.wallet.balance, orderNo: result.order.orderNo };
        } catch (error) {
            // Crediting failed, so give the card back rather than swallowing the user's money.
            await this.db.update(redeemCards).set({ status: "unused", redeemedBy: null, redeemedAt: null }).where(eq(redeemCards.id, card.id));
            throw error;
        }
    }

    async voidCards(ids: string[]) {
        if (!ids.length) return 0;
        const updated = await this.db
            .update(redeemCards)
            .set({ status: "void" })
            .where(and(eq(redeemCards.status, "unused"), inArray(redeemCards.id, ids)))
            .returning({ id: redeemCards.id });
        return updated.length;
    }

    async deleteCards(ids: string[]) {
        if (!ids.length) return 0;
        const removed = await this.db.delete(redeemCards).where(inArray(redeemCards.id, ids)).returning({ id: redeemCards.id });
        return removed.length;
    }

    async deleteBatches(ids: string[]) {
        if (!ids.length) return 0;
        const removed = await this.db.delete(redeemCardBatches).where(inArray(redeemCardBatches.id, ids)).returning({ id: redeemCardBatches.id });
        return removed.length;
    }

    async listBatches(query: { page: number; pageSize: number; keyword?: string }): Promise<Paginated<Record<string, unknown>>> {
        const keyword = query.keyword?.trim();
        const where = keyword ? ilike(redeemCardBatches.name, `%${keyword}%`) : undefined;
        const [items, [counted]] = await Promise.all([
            this.db
                .select({
                    id: redeemCardBatches.id,
                    name: redeemCardBatches.name,
                    faceValue: redeemCardBatches.faceValue,
                    quantity: redeemCardBatches.quantity,
                    expiresAt: redeemCardBatches.expiresAt,
                    createdAt: redeemCardBatches.createdAt,
                    usedCount: sql<number>`(select count(*)::int from ${redeemCards} where ${redeemCards.batchId} = ${redeemCardBatches.id} and ${redeemCards.status} = 'used')`,
                    voidCount: sql<number>`(select count(*)::int from ${redeemCards} where ${redeemCards.batchId} = ${redeemCardBatches.id} and ${redeemCards.status} = 'void')`,
                })
                .from(redeemCardBatches)
                .where(where)
                .orderBy(desc(redeemCardBatches.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(redeemCardBatches).where(where),
        ]);
        return { items, total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    async listCards(query: { page: number; pageSize: number; batchId?: string; status?: "unused" | "used" | "void" }): Promise<Paginated<typeof redeemCards.$inferSelect>> {
        const filters = [query.batchId ? eq(redeemCards.batchId, query.batchId) : undefined, query.status ? eq(redeemCards.status, query.status) : undefined].filter(Boolean);
        const where = filters.length ? and(...filters) : undefined;
        const [items, [counted]] = await Promise.all([
            this.db
                .select()
                .from(redeemCards)
                .where(where)
                .orderBy(desc(redeemCards.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(redeemCards).where(where),
        ]);
        return { items, total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    /** Plain-text export for handing cards to a distributor. */
    async exportBatch(batchId: string) {
        const cards = await this.db.select({ code: redeemCards.code, status: redeemCards.status }).from(redeemCards).where(eq(redeemCards.batchId, batchId));
        return cards;
    }
}

function generateCode() {
    const groups: string[] = [];
    for (let group = 0; group < CODE_GROUPS; group += 1) {
        let chunk = "";
        for (let index = 0; index < CODE_GROUP_SIZE; index += 1) chunk += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
        groups.push(chunk);
    }
    return groups.join("-");
}

function maskCode(code: string) {
    return code.length > 4 ? `${code.slice(0, 4)}****${code.slice(-4)}` : code;
}
