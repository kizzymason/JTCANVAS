import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { REDIS } from "../../redis/redis.module";
import { rateLimited } from "./openai-errors";

const RPM_PREFIX = "openapi:rpm:";
const CONCURRENCY_PREFIX = "openapi:inflight:";
/** Safety net: an in-flight slot is released on completion, but a crashed process must not leak one. */
const CONCURRENCY_TTL_SECONDS = 1_800;

export type RateLimitDecision = {
    limit: number;
    remaining: number;
    resetSeconds: number;
};

/**
 * Per-key request limiting.
 *
 * RPM uses a fixed 60-second bucket keyed on the current minute: it is one INCR plus one EXPIRE,
 * which is cheap enough to sit in front of every call, and the worst case (a burst straddling a
 * bucket boundary) is bounded at 2× the limit — acceptable for abuse control, and far simpler to
 * reason about than a sorted-set sliding window.
 */
@Injectable()
export class RateLimitService {
    private readonly defaultRpm: number;
    private readonly defaultConcurrency: number;

    constructor(
        @Inject(REDIS) private readonly redis: Redis,
        config: ConfigService,
    ) {
        this.defaultRpm = config.get<number>("openPlatform.defaultRpm")!;
        this.defaultConcurrency = config.get<number>("openPlatform.defaultConcurrency")!;
    }

    rpmLimitFor(keyRpm: number) {
        return keyRpm > 0 ? keyRpm : this.defaultRpm;
    }

    concurrencyLimitFor(keyConcurrency: number) {
        return keyConcurrency > 0 ? keyConcurrency : this.defaultConcurrency;
    }

    async consumeRequest(apiKeyId: string, keyRpm: number): Promise<RateLimitDecision> {
        const limit = this.rpmLimitFor(keyRpm);
        const minute = Math.floor(Date.now() / 60_000);
        const bucket = `${RPM_PREFIX}${apiKeyId}:${minute}`;

        const pipeline = this.redis.multi().incr(bucket).expire(bucket, 120);
        const results = await pipeline.exec();
        const used = Number(results?.[0]?.[1] ?? 0);
        const resetSeconds = 60 - Math.floor((Date.now() % 60_000) / 1000);

        if (used > limit) {
            throw rateLimited(`Rate limit reached for this API key: ${limit} requests per minute. Please retry in ${resetSeconds}s.`, "rate_limit_exceeded", {
                "retry-after": String(resetSeconds),
                "x-ratelimit-limit-requests": String(limit),
                "x-ratelimit-remaining-requests": "0",
                "x-ratelimit-reset-requests": `${resetSeconds}s`,
            });
        }
        return { limit, remaining: Math.max(0, limit - used), resetSeconds };
    }

    /** Acquires an in-flight slot, or rejects. Always pair with `releaseSlot` in a finally block. */
    async acquireSlot(apiKeyId: string, keyConcurrency: number) {
        const limit = this.concurrencyLimitFor(keyConcurrency);
        const bucket = `${CONCURRENCY_PREFIX}${apiKeyId}`;
        const inflight = await this.redis.incr(bucket);
        await this.redis.expire(bucket, CONCURRENCY_TTL_SECONDS);
        if (inflight > limit) {
            await this.redis.decr(bucket);
            throw rateLimited(`Too many concurrent requests for this API key: the limit is ${limit}. Please retry shortly.`, "concurrency_limit_exceeded", {
                "retry-after": "1",
                "x-ratelimit-limit-concurrent": String(limit),
                "x-ratelimit-remaining-concurrent": "0",
            });
        }
        return limit;
    }

    async releaseSlot(apiKeyId: string) {
        const bucket = `${CONCURRENCY_PREFIX}${apiKeyId}`;
        const inflight = await this.redis.decr(bucket);
        // Guard against drift from an expired counter going negative.
        if (inflight < 0) await this.redis.set(bucket, 0, "EX", CONCURRENCY_TTL_SECONDS);
    }
}
