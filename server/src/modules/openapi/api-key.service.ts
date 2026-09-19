import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import Redis from "ioredis";
import { DB, type Database } from "../../db/db.module";
import { apiKeys, resellerAccounts, resellerTiers } from "../../db/schema";
import { badRequest, notFound } from "../../common/errors";
import { money, toMoneyString } from "../../common/money";
import type { Paginated } from "../../common/types";
import { REDIS } from "../../redis/redis.module";

/** Namespaced so a key pasted into a log is instantly recognisable as ours. */
export const API_KEY_PREFIX = "sk-jt-";
const SECRET_BYTES = 32;
const CACHE_PREFIX = "openapi:key:";
const CACHE_TTL_SECONDS = 60;
/** Cached for absent keys too, so a credential-stuffing run cannot hammer Postgres. */
const MISS_MARKER = "-";

export type ApiKeyRow = typeof apiKeys.$inferSelect;

/** Everything the guard needs, resolved in one hop and cacheable as a unit. */
export type ResolvedApiKey = {
    id: string;
    userId: string;
    status: string;
    quotaLimit: string | null;
    quotaUsed: string;
    rpmLimit: number;
    concurrencyLimit: number;
    modelScope: string[];
    allowedIps: string[];
    expiresAt: string | null;
    /** Reseller state, so the guard can reject a suspended reseller without a second query. */
    resellerStatus: string | null;
    multiplierOverride: string | null;
    tierMultiplier: string | null;
};

export type CreateApiKeyInput = {
    name?: string;
    quotaLimit?: string | null;
    rpmLimit?: number;
    concurrencyLimit?: number;
    modelScope?: string[];
    allowedIps?: string[];
    expiresAt?: string | null;
};

export type UpdateApiKeyInput = CreateApiKeyInput & { status?: "active" | "disabled" };

function hashKey(plaintext: string) {
    return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Issues and resolves downstream credentials.
 *
 * Only the SHA-256 hash is persisted: the plaintext is returned exactly once, at creation. That means
 * a lost key cannot be recovered, which is the same trade every provider makes and the reason the
 * console offers "create another" rather than "reveal".
 */
@Injectable()
export class ApiKeyService {
    constructor(
        @Inject(DB) private readonly db: Database,
        @Inject(REDIS) private readonly redis: Redis,
    ) {}

    async create(userId: string, input: CreateApiKeyInput) {
        // base64url over 32 random bytes: 43 chars of entropy, URL-safe, no separator ambiguity.
        const secret = randomBytes(SECRET_BYTES).toString("base64url");
        const plaintext = `${API_KEY_PREFIX}${secret}`;
        const [row] = await this.db
            .insert(apiKeys)
            .values({
                userId,
                name: input.name?.trim() || "默认令牌",
                keyPrefix: plaintext.slice(0, API_KEY_PREFIX.length + 6),
                keyHash: hashKey(plaintext),
                keyTail: plaintext.slice(-4),
                ...this.mutableFields(input),
            })
            .returning();
        return { key: this.toResponse(row), plaintext };
    }

    async list(userId: string, query: { page: number; pageSize: number }): Promise<Paginated<ReturnType<ApiKeyService["toResponse"]>>> {
        const where = eq(apiKeys.userId, userId);
        const [items, [counted]] = await Promise.all([
            this.db
                .select()
                .from(apiKeys)
                .where(where)
                .orderBy(desc(apiKeys.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(apiKeys).where(where),
        ]);
        return { items: items.map((item) => this.toResponse(item)), total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    /** Names and ids only, for the log page's filter dropdown. */
    async listAll(userId: string) {
        const rows = await this.db
            .select({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix, keyTail: apiKeys.keyTail })
            .from(apiKeys)
            .where(eq(apiKeys.userId, userId))
            .orderBy(desc(apiKeys.createdAt));
        return rows;
    }

    async update(userId: string, id: string, input: UpdateApiKeyInput) {
        const existing = await this.owned(userId, id);
        const [row] = await this.db
            .update(apiKeys)
            .set({ ...this.mutableFields(input), ...(input.status ? { status: input.status } : {}), updatedAt: new Date() })
            .where(eq(apiKeys.id, existing.id))
            .returning();
        await this.invalidate(row.keyHash);
        return this.toResponse(row);
    }

    async remove(userId: string, id: string) {
        const existing = await this.owned(userId, id);
        await this.db.delete(apiKeys).where(eq(apiKeys.id, existing.id));
        await this.invalidate(existing.keyHash);
        return { removed: 1 };
    }

    /** Zeroes the consumed quota without issuing a new secret, so integrations stay up. */
    async resetQuota(userId: string, id: string) {
        const existing = await this.owned(userId, id);
        const [row] = await this.db.update(apiKeys).set({ quotaUsed: toMoneyString(0), updatedAt: new Date() }).where(eq(apiKeys.id, existing.id)).returning();
        await this.invalidate(row.keyHash);
        return this.toResponse(row);
    }

    /**
     * Authenticates a plaintext key. The lookup is by hash, so the comparison is a single indexed
     * equality; `timingSafeEqual` on the hashes keeps it constant-time against a crafted prefix.
     */
    async resolve(plaintext: string): Promise<ResolvedApiKey | null> {
        if (!plaintext.startsWith(API_KEY_PREFIX)) return null;
        const keyHash = hashKey(plaintext);
        const cacheKey = `${CACHE_PREFIX}${keyHash}`;

        const cached = await this.redis.get(cacheKey);
        if (cached === MISS_MARKER) return null;
        if (cached) return JSON.parse(cached) as ResolvedApiKey;

        const [row] = await this.db
            .select({
                id: apiKeys.id,
                userId: apiKeys.userId,
                keyHash: apiKeys.keyHash,
                status: apiKeys.status,
                quotaLimit: apiKeys.quotaLimit,
                quotaUsed: apiKeys.quotaUsed,
                rpmLimit: apiKeys.rpmLimit,
                concurrencyLimit: apiKeys.concurrencyLimit,
                modelScope: apiKeys.modelScope,
                allowedIps: apiKeys.allowedIps,
                expiresAt: apiKeys.expiresAt,
                resellerStatus: resellerAccounts.status,
                multiplierOverride: resellerAccounts.multiplierOverride,
                tierMultiplier: resellerTiers.multiplier,
            })
            .from(apiKeys)
            .leftJoin(resellerAccounts, eq(resellerAccounts.userId, apiKeys.userId))
            .leftJoin(resellerTiers, eq(resellerTiers.id, resellerAccounts.tierId))
            .where(eq(apiKeys.keyHash, keyHash))
            .limit(1);

        if (!row || !constantTimeEquals(row.keyHash, keyHash)) {
            await this.redis.set(cacheKey, MISS_MARKER, "EX", CACHE_TTL_SECONDS);
            return null;
        }

        const resolved: ResolvedApiKey = {
            id: row.id,
            userId: row.userId,
            status: row.status,
            quotaLimit: row.quotaLimit,
            quotaUsed: row.quotaUsed,
            rpmLimit: row.rpmLimit,
            concurrencyLimit: row.concurrencyLimit,
            modelScope: row.modelScope ?? [],
            allowedIps: row.allowedIps ?? [],
            expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
            resellerStatus: row.resellerStatus ?? null,
            multiplierOverride: row.multiplierOverride ?? null,
            tierMultiplier: row.tierMultiplier ?? null,
        };
        await this.redis.set(cacheKey, JSON.stringify(resolved), "EX", CACHE_TTL_SECONDS);
        return resolved;
    }

    /**
     * Replaces a submit-time quota reservation with the worker's final charge. Failed tasks pass an
     * actual amount of zero, releasing the whole reservation. SQL arithmetic prevents concurrent
     * completions on one key from losing an adjustment.
     */
    async settleUsageReservation(id: string, reservedAmount: string, actualAmount: string) {
        const reserved = toMoneyString(reservedAmount);
        const actual = toMoneyString(actualAmount);
        const [row] = await this.db
            .update(apiKeys)
            .set({
                quotaUsed: sql`greatest(0, ${apiKeys.quotaUsed} - ${reserved}::numeric + ${actual}::numeric)`,
                updatedAt: new Date(),
            })
            .where(eq(apiKeys.id, id))
            .returning({ keyHash: apiKeys.keyHash });
        if (row) await this.invalidate(row.keyHash);
    }

    touch(id: string) {
        return this.db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
    }

    async countFor(userId: string) {
        const [row] = await this.db.select({ total: sql<number>`count(*)::int` }).from(apiKeys).where(eq(apiKeys.userId, userId));
        return row?.total ?? 0;
    }

    /** Drops every cached entry for a user, used when an admin suspends a reseller. */
    async invalidateUser(userId: string) {
        const rows = await this.db.select({ keyHash: apiKeys.keyHash }).from(apiKeys).where(eq(apiKeys.userId, userId));
        await Promise.all(rows.map((row) => this.invalidate(row.keyHash)));
    }

    private invalidate(keyHash: string) {
        return this.redis.del(`${CACHE_PREFIX}${keyHash}`);
    }

    private async owned(userId: string, id: string) {
        const [row] = await this.db
            .select()
            .from(apiKeys)
            .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
            .limit(1);
        if (!row) throw notFound("令牌不存在");
        return row;
    }

    private mutableFields(input: CreateApiKeyInput) {
        const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
        if (input.expiresAt && Number.isNaN(expiresAt!.getTime())) throw badRequest("INVALID_EXPIRES_AT", "过期时间格式不正确");
        if (input.quotaLimit !== undefined && input.quotaLimit !== null) {
            let quota;
            try {
                quota = money(input.quotaLimit);
            } catch {
                throw badRequest("INVALID_QUOTA_LIMIT", "额度上限格式不正确");
            }
            if (!quota.isPositive() || quota.decimalPlaces() > 6 || quota.gte("1000000000000")) {
                throw badRequest("INVALID_QUOTA_LIMIT", "额度上限必须是大于 0 且最多 6 位小数的有效金额");
            }
        }
        return {
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.quotaLimit !== undefined ? { quotaLimit: input.quotaLimit ? toMoneyString(input.quotaLimit) : null } : {}),
            ...(input.rpmLimit !== undefined ? { rpmLimit: Math.max(0, Math.floor(input.rpmLimit)) } : {}),
            ...(input.concurrencyLimit !== undefined ? { concurrencyLimit: Math.max(0, Math.floor(input.concurrencyLimit)) } : {}),
            ...(input.modelScope !== undefined ? { modelScope: input.modelScope } : {}),
            ...(input.allowedIps !== undefined ? { allowedIps: input.allowedIps } : {}),
            ...(input.expiresAt !== undefined ? { expiresAt } : {}),
        };
    }

    /** Never includes the hash: the console only ever shows the prefix and tail. */
    private toResponse(row: ApiKeyRow) {
        return {
            id: row.id,
            name: row.name,
            keyPrefix: row.keyPrefix,
            keyTail: row.keyTail,
            status: row.status,
            quotaLimit: row.quotaLimit,
            quotaUsed: row.quotaUsed,
            rpmLimit: row.rpmLimit,
            concurrencyLimit: row.concurrencyLimit,
            modelScope: row.modelScope ?? [],
            allowedIps: row.allowedIps ?? [],
            expiresAt: row.expiresAt,
            lastUsedAt: row.lastUsedAt,
            createdAt: row.createdAt,
        };
    }
}

function constantTimeEquals(a: string, b: string) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
}
