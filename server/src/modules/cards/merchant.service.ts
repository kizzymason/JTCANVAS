import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import { asc } from "drizzle-orm";
import Redis from "ioredis";
import { DB, type Database } from "../../db/db.module";
import { cardMerchantPrices, cardMerchants, cardOrders, cardProducts } from "../../db/schema";
import { badRequest, forbidden, notFound } from "../../common/errors";
import { money, toMoneyString } from "../../common/money";
import { REDIS } from "../../redis/redis.module";
import { CryptoService } from "../crypto/crypto.service";
import { commissionFor, resolveReturnUrl, type CommissionTerms } from "./merchant.rules";
import type { UpsertCardMerchantDto } from "./dto/card-dist.dto";

/** Namespaced so a leaked key is instantly recognisable as a card-channel credential. */
export const MERCHANT_SECRET_PREFIX = "sk_cd_";
const SECRET_BYTES = 32;
const CACHE_PREFIX = "carddist:merchant:";
const CACHE_TTL_SECONDS = 60;
/** Cached for unknown secrets too, so credential stuffing cannot hammer Postgres. */
const MISS_MARKER = "-";

export type MerchantRow = typeof cardMerchants.$inferSelect;

/** Everything the guard and the checkout need, resolvable in one hop and cacheable as a unit. */
export type ResolvedMerchant = {
    id: string;
    name: string;
    enabled: boolean;
    commissionMode: "rate" | "fixed";
    commissionRate: string;
    holdDays: number;
    dailySalesLimit: string;
    productScope: string[];
    allowedIps: string[];
    returnUrls: string[];
    checkoutLabel: string;
    preferredChannelId: string | null;
};

function hashSecret(plaintext: string) {
    return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Sales channels and their commission terms.
 *
 * A channel is a cashier, not a merchant: it never sets a price and never touches money. Everything
 * here that looks like pricing is *our* price that the channel is permitted to display, and
 * everything that looks like a balance is commission we owe it.
 *
 * Only the SHA-256 of the secret is persisted, so a database leak cannot be replayed against the
 * API; the plaintext is returned exactly once, at issue time. That is the same trade the open
 * platform makes for its API keys, and the reason the console offers "re-issue" rather than "reveal".
 */
@Injectable()
export class MerchantService {
    private readonly logger = new Logger(MerchantService.name);

    constructor(
        @Inject(DB) private readonly db: Database,
        @Inject(REDIS) private readonly redis: Redis,
        private readonly crypto: CryptoService,
    ) {}

    async create(input: UpsertCardMerchantDto) {
        this.assertTerms(input);
        const secret = `${MERCHANT_SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString("base64url")}`;
        const [row] = await this.db
            .insert(cardMerchants)
            .values({
                name: input.name.trim(),
                secretPrefix: secret.slice(0, MERCHANT_SECRET_PREFIX.length + 6),
                secretTail: secret.slice(-4),
                secretHash: hashSecret(secret),
                ...this.mutableFields(input),
                ...this.webhookFields(input),
            })
            .returning();
        return { merchant: this.toAdmin(row), secret };
    }

    async update(id: string, input: UpsertCardMerchantDto) {
        this.assertTerms(input);
        const before = await this.require(id);
        const [row] = await this.db
            .update(cardMerchants)
            .set({ name: input.name.trim(), ...this.mutableFields(input), ...this.webhookFields(input), updatedAt: new Date() })
            .where(eq(cardMerchants.id, id))
            .returning();
        await this.invalidate(before.secretHash);
        return { merchant: this.toAdmin(row), before: this.toAdmin(before) };
    }

    /** Rotating the secret is the only way to recover from a leak, since we never stored the old one. */
    async reissueSecret(id: string) {
        const before = await this.require(id);
        const secret = `${MERCHANT_SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString("base64url")}`;
        const [row] = await this.db
            .update(cardMerchants)
            .set({
                secretPrefix: secret.slice(0, MERCHANT_SECRET_PREFIX.length + 6),
                secretTail: secret.slice(-4),
                secretHash: hashSecret(secret),
                updatedAt: new Date(),
            })
            .where(eq(cardMerchants.id, id))
            .returning();
        await this.invalidate(before.secretHash);
        return { merchant: this.toAdmin(row), secret };
    }

    /** Stops a channel immediately, recording why. Used by the automatic refund-rate guard too. */
    async suspend(id: string, reason: string) {
        const before = await this.require(id);
        if (!before.enabled) return { merchant: this.toAdmin(before), changed: false };
        const [row] = await this.db
            .update(cardMerchants)
            .set({ enabled: false, suspendedReason: reason, updatedAt: new Date() })
            .where(eq(cardMerchants.id, id))
            .returning();
        await this.invalidate(before.secretHash);
        this.logger.warn(`Suspended channel ${before.name}: ${reason}`);
        return { merchant: this.toAdmin(row), changed: true };
    }

    async remove(id: string) {
        const before = await this.require(id);
        if (money(before.commissionBalance).gt(0)) {
            throw badRequest("MERCHANT_HAS_COMMISSION", "该渠道仍有未结算佣金，请先分红或冲正为 0 再删除");
        }
        const [sold] = await this.db
            .select({ total: sql<number>`count(*)::int` })
            .from(cardOrders)
            .where(eq(cardOrders.merchantId, id));
        if ((sold?.total ?? 0) > 0) {
            // Deleting would orphan paid orders from the channel that sold them, and those rows are
            // the evidence behind every dividend already paid.
            throw badRequest("MERCHANT_HAS_ORDERS", "该渠道已有成交订单，请改为停用而不是删除");
        }
        await this.db.delete(cardMerchants).where(eq(cardMerchants.id, id));
        await this.invalidate(before.secretHash);
        return { id, before: this.toAdmin(before) };
    }

    async list() {
        const rows = await this.db.select().from(cardMerchants).orderBy(asc(cardMerchants.name));
        const prices = rows.length
            ? await this.db.select().from(cardMerchantPrices).where(inArray(cardMerchantPrices.merchantId, rows.map((row) => row.id)))
            : [];
        return {
            items: rows.map((row) => ({
                ...this.toAdmin(row),
                prices: prices.filter((price) => price.merchantId === row.id).map((price) => ({ productId: price.productId, unitPrice: price.unitPrice })),
            })),
        };
    }

    /**
     * Authenticates a plaintext secret. Lookup is by hash so the comparison is a single indexed
     * equality; `timingSafeEqual` on the hashes keeps it constant-time against a crafted prefix.
     */
    async resolveSecret(plaintext: string): Promise<ResolvedMerchant | null> {
        if (!plaintext.startsWith(MERCHANT_SECRET_PREFIX)) return null;
        const secretHash = hashSecret(plaintext);
        const cacheKey = `${CACHE_PREFIX}${secretHash}`;

        const cached = await this.redis.get(cacheKey);
        if (cached === MISS_MARKER) return null;
        if (cached) return JSON.parse(cached) as ResolvedMerchant;

        const [row] = await this.db.select().from(cardMerchants).where(eq(cardMerchants.secretHash, secretHash)).limit(1);
        if (!row || !constantTimeEquals(row.secretHash, secretHash)) {
            await this.redis.set(cacheKey, MISS_MARKER, "EX", CACHE_TTL_SECONDS);
            return null;
        }

        const resolved = this.toResolved(row);
        await this.redis.set(cacheKey, JSON.stringify(resolved), "EX", CACHE_TTL_SECONDS);
        return resolved;
    }

    /**
     * What the buyer pays. Either the storefront price or a per-channel price we approved — never
     * anything the caller supplied, which is what stops a downstream from discounting our goods or
     * pushing a mismatched amount through our payment channel.
     */
    async retailPriceFor(merchantId: string, product: typeof cardProducts.$inferSelect) {
        const [override] = await this.db
            .select()
            .from(cardMerchantPrices)
            .where(and(eq(cardMerchantPrices.merchantId, merchantId), eq(cardMerchantPrices.productId, product.id)))
            .limit(1);
        return toMoneyString(override ? override.unitPrice : product.salePrice);
    }

    commissionFor(merchant: CommissionTerms, params: { amount: string; quantity: number }) {
        return commissionFor(merchant, params);
    }

    /** Products this channel may sell, honouring its scope. */
    async scopedProducts(merchant: ResolvedMerchant) {
        const rows = await this.db
            .select()
            .from(cardProducts)
            .where(eq(cardProducts.enabled, true))
            .orderBy(asc(cardProducts.sortOrder), asc(cardProducts.createdAt));
        if (!merchant.productScope.length) return rows;
        return rows.filter((row) => merchant.productScope.includes(row.id));
    }

    assertProductAllowed(merchant: ResolvedMerchant, productId: string) {
        if (!merchant.productScope.length) return;
        if (!merchant.productScope.includes(productId)) throw forbidden("该渠道无权销售此商品");
    }

    assertIpAllowed(merchant: ResolvedMerchant, ip: string) {
        if (!merchant.allowedIps.length) return;
        if (merchant.allowedIps.includes(ip)) return;
        throw forbidden(`来源地址 ${ip || "未知"} 不在该渠道的 IP 白名单内`);
    }

    resolveReturnUrl(merchant: Pick<ResolvedMerchant, "returnUrls">, requested?: string) {
        return resolveReturnUrl(merchant, requested);
    }

    /** Description the payment page shows. Kept neutral and stable rather than naming the category. */
    checkoutLabelFor(merchant: Pick<ResolvedMerchant, "checkoutLabel">, fallback: string) {
        return merchant.checkoutLabel.trim() || fallback;
    }

    async replacePrices(merchantId: string, prices: Array<{ productId: string; unitPrice: string }>) {
        await this.require(merchantId);
        await this.db.transaction(async (tx) => {
            await tx.delete(cardMerchantPrices).where(eq(cardMerchantPrices.merchantId, merchantId));
            if (!prices.length) return;
            await tx.insert(cardMerchantPrices).values(prices.map((price) => ({ merchantId, productId: price.productId, unitPrice: toMoneyString(price.unitPrice) })));
        });
        return { merchantId, count: prices.length };
    }

    async touch(id: string) {
        await this.db.update(cardMerchants).set({ lastUsedAt: new Date() }).where(eq(cardMerchants.id, id));
    }

    async require(id: string) {
        const [row] = await this.db.select().from(cardMerchants).where(eq(cardMerchants.id, id)).limit(1);
        if (!row) throw notFound("销售渠道不存在");
        return row;
    }

    /** Dropped whenever anything the guard reads changes, so a disabled channel stops immediately. */
    async invalidate(secretHash: string) {
        await this.redis.del(`${CACHE_PREFIX}${secretHash}`);
    }

    async invalidateById(id: string) {
        const [row] = await this.db.select({ secretHash: cardMerchants.secretHash }).from(cardMerchants).where(eq(cardMerchants.id, id)).limit(1);
        if (row) await this.invalidate(row.secretHash);
    }

    webhookSecretFor(row: MerchantRow) {
        if (!row.webhookSecretCipher) return "";
        return this.crypto.decrypt(row.webhookSecretCipher, row.webhookSecretKeyId);
    }

    toResolved(row: MerchantRow): ResolvedMerchant {
        return {
            id: row.id,
            name: row.name,
            enabled: row.enabled,
            commissionMode: row.commissionMode,
            commissionRate: row.commissionRate,
            holdDays: row.holdDays,
            dailySalesLimit: row.dailySalesLimit,
            productScope: row.productScope ?? [],
            allowedIps: row.allowedIps ?? [],
            returnUrls: row.returnUrls ?? [],
            checkoutLabel: row.checkoutLabel,
            preferredChannelId: row.preferredChannelId,
        };
    }

    private mutableFields(input: UpsertCardMerchantDto) {
        return {
            commissionMode: input.commissionMode ?? "rate",
            commissionRate: toMoneyString(input.commissionRate ?? "0"),
            holdDays: input.holdDays ?? 7,
            dailySalesLimit: toMoneyString(input.dailySalesLimit ?? "0"),
            productScope: input.productScope ?? [],
            allowedIps: (input.allowedIps ?? []).map((ip) => ip.trim()).filter(Boolean),
            returnUrls: (input.returnUrls ?? []).map((url) => url.trim()).filter(Boolean),
            checkoutLabel: input.checkoutLabel?.trim() ?? "",
            preferredChannelId: input.preferredChannelId ?? null,
            payoutAccount: input.payoutAccount?.trim() ?? "",
            enabled: input.enabled ?? true,
            suspendedReason: input.enabled === false ? "管理员手动停用" : "",
        };
    }

    private webhookFields(input: UpsertCardMerchantDto) {
        const url = input.webhookUrl?.trim() ?? "";
        if (!url) return { webhookUrl: "", webhookSecretCipher: "", webhookSecretKeyId: "" };
        // A webhook without a secret cannot be verified by the receiver, so one is always minted.
        const secret = input.webhookSecret?.trim() || randomBytes(24).toString("base64url");
        const encrypted = this.crypto.encrypt(secret);
        return { webhookUrl: url, webhookSecretCipher: encrypted.cipher, webhookSecretKeyId: encrypted.keyId };
    }

    private assertTerms(input: UpsertCardMerchantDto) {
        const rate = money(input.commissionRate ?? "0");
        if (rate.isNegative()) throw badRequest("MERCHANT_RATE_INVALID", "佣金不能为负数");
        if ((input.commissionMode ?? "rate") === "rate" && rate.gt(1)) {
            throw badRequest("MERCHANT_RATE_INVALID", "佣金比例不能超过 100%，否则分红会高于收款");
        }
        for (const url of input.returnUrls ?? []) {
            if (!/^https?:\/\/[^\s]+$/i.test(url.trim())) throw badRequest("MERCHANT_RETURN_URL_INVALID", `回跳地址格式不正确：${url}`);
        }
    }

    /** Never includes the hash: the console only ever shows the prefix and tail. */
    private toAdmin(row: MerchantRow) {
        return {
            id: row.id,
            name: row.name,
            secretPrefix: row.secretPrefix,
            secretTail: row.secretTail,
            commissionMode: row.commissionMode,
            commissionRate: row.commissionRate,
            commissionBalance: row.commissionBalance,
            holdDays: row.holdDays,
            dailySalesLimit: row.dailySalesLimit,
            productScope: row.productScope ?? [],
            allowedIps: row.allowedIps ?? [],
            returnUrls: row.returnUrls ?? [],
            checkoutLabel: row.checkoutLabel,
            preferredChannelId: row.preferredChannelId,
            payoutAccount: row.payoutAccount,
            webhookUrl: row.webhookUrl,
            hasWebhookSecret: Boolean(row.webhookSecretCipher),
            enabled: row.enabled,
            suspendedReason: row.suspendedReason,
            lastUsedAt: row.lastUsedAt,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }
}

function constantTimeEquals(a: string, b: string) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
}
