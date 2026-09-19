import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import Redis from "ioredis";
import { DB, type Database } from "../../db/db.module";
import { resellerAccounts, resellerTiers } from "../../db/schema";
import { REDIS } from "../../redis/redis.module";
import { NEUTRAL_MULTIPLIER, effectiveMultiplier } from "./reseller-multiplier";

const CACHE_PREFIX = "reseller:multiplier:";
const CACHE_TTL_SECONDS = 60;

/**
 * Resolves the billing coefficient for a reseller. Sits on the submit hot path, so the answer is
 * cached briefly; the cache is dropped explicitly whenever an admin edits a tier or an account, which
 * makes the TTL a safety net rather than the invalidation mechanism.
 */
@Injectable()
export class ResellerPricingService {
    constructor(
        @Inject(DB) private readonly db: Database,
        @Inject(REDIS) private readonly redis: Redis,
    ) {}

    async multiplierFor(userId: string) {
        const cacheKey = `${CACHE_PREFIX}${userId}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return cached;

        const multiplier = effectiveMultiplier(await this.sourceFor(userId));
        await this.redis.set(cacheKey, multiplier, "EX", CACHE_TTL_SECONDS);
        return multiplier;
    }

    /** The account row joined with its tier, or null when the user never applied. */
    async sourceFor(userId: string) {
        const [row] = await this.db
            .select({
                status: resellerAccounts.status,
                multiplierOverride: resellerAccounts.multiplierOverride,
                tierId: resellerAccounts.tierId,
                tierName: resellerTiers.name,
                tierMultiplier: resellerTiers.multiplier,
            })
            .from(resellerAccounts)
            .leftJoin(resellerTiers, eq(resellerTiers.id, resellerAccounts.tierId))
            .where(eq(resellerAccounts.userId, userId))
            .limit(1);
        return row ?? null;
    }

    invalidate(userId: string) {
        return this.redis.del(`${CACHE_PREFIX}${userId}`);
    }

    /** Used after a tier's multiplier changes, which can affect any number of accounts. */
    async invalidateAll() {
        const keys = await this.redis.keys(`${CACHE_PREFIX}*`);
        if (keys.length) await this.redis.del(...keys);
    }

    static readonly neutral = NEUTRAL_MULTIPLIER;
}
