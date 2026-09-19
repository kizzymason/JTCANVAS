import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRedis } from "../../test/memory-redis";
import type { OpenAiApiError } from "./openai-errors";
import { RateLimitService } from "./rate-limit.service";

const DEFAULT_RPM = 60;
const DEFAULT_CONCURRENCY = 4;

function service() {
    const config = {
        get: (path: string) => (path === "openPlatform.defaultRpm" ? DEFAULT_RPM : DEFAULT_CONCURRENCY),
    };
    return new RateLimitService(new MemoryRedis() as never, config as never);
}

describe("rpmLimitFor / concurrencyLimitFor", () => {
    it("treats 0 on the key as 'use the platform default'", () => {
        const limiter = service();
        expect(limiter.rpmLimitFor(0)).toBe(DEFAULT_RPM);
        expect(limiter.rpmLimitFor(10)).toBe(10);
        expect(limiter.concurrencyLimitFor(0)).toBe(DEFAULT_CONCURRENCY);
        expect(limiter.concurrencyLimitFor(2)).toBe(2);
    });
});

describe("consumeRequest", () => {
    let limiter: RateLimitService;

    beforeEach(() => {
        limiter = service();
    });

    it("counts down the remaining allowance within the window", async () => {
        const first = await limiter.consumeRequest("key-1", 3);
        expect(first).toMatchObject({ limit: 3, remaining: 2 });
        expect(await limiter.consumeRequest("key-1", 3)).toMatchObject({ remaining: 1 });
        expect(await limiter.consumeRequest("key-1", 3)).toMatchObject({ remaining: 0 });
    });

    it("rejects the call past the limit with a 429 the client can back off from", async () => {
        for (let index = 0; index < 2; index += 1) await limiter.consumeRequest("key-1", 2);
        const error = (await limiter.consumeRequest("key-1", 2).catch((thrown: OpenAiApiError) => thrown)) as OpenAiApiError;
        expect(error.getStatus()).toBe(429);
        expect(error.getResponse()).toMatchObject({ error: { type: "rate_limit_exceeded" } });
    });

    it("counts each key separately", async () => {
        await limiter.consumeRequest("key-1", 1);
        expect(await limiter.consumeRequest("key-2", 1)).toMatchObject({ remaining: 0 });
    });

    it("always reports a reset within the next minute", async () => {
        const decision = await limiter.consumeRequest("key-1", 10);
        expect(decision.resetSeconds).toBeGreaterThan(0);
        expect(decision.resetSeconds).toBeLessThanOrEqual(60);
    });
});

describe("acquireSlot / releaseSlot", () => {
    it("blocks the call that would exceed the concurrency limit", async () => {
        const limiter = service();
        await limiter.acquireSlot("key-1", 2);
        await limiter.acquireSlot("key-1", 2);
        await expect(limiter.acquireSlot("key-1", 2)).rejects.toMatchObject({ response: { error: { type: "rate_limit_exceeded" } } });
    });

    it("frees the slot again on release, so a rejected call did not consume one", async () => {
        const limiter = service();
        await limiter.acquireSlot("key-1", 1);
        await limiter.acquireSlot("key-1", 1).catch(() => undefined);
        await limiter.releaseSlot("key-1");
        await expect(limiter.acquireSlot("key-1", 1)).resolves.toBe(1);
    });

    it("does not let a drifted counter go negative and hand out extra slots", async () => {
        const limiter = service();
        await limiter.releaseSlot("key-1");
        await limiter.acquireSlot("key-1", 1);
        await expect(limiter.acquireSlot("key-1", 1)).rejects.toBeTruthy();
    });
});
