import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgClient } from "../../db/db.module";
import * as schema from "../../db/schema";
import { channels, channelModels, modelPrices } from "../../db/schema";
import { PricingService } from "../pricing/pricing.service";
import { repriceWhatsTokenChannel } from "./whatstoken-repricing";
import { seedWhatsTokenChannel } from "./whatstoken-channel.seed";
import { settleGenerationTask } from "./generation-settlement";
import { seedanceTokensFor } from "./whatstoken-catalog";

// Integration tests must point to an isolated database.
const client = createPgClient(process.env.DATABASE_URL || "postgres://infinite:infinite@127.0.0.1:55433/infinite_canvas", 5);
const db = drizzle(client, { schema });
const ids: string[] = [];
let channelId: string;
const cache = new Map<string, string>();
const pricing = new PricingService(db, { get: async (key: string) => cache.get(key), set: async (key: string, value: string) => cache.set(key, value), del: async (key: string) => cache.delete(key) } as never);
async function price(name: string, spec: string) {
    const [model] = await db.select().from(channelModels).where(and(eq(channelModels.channelId, channelId), eq(channelModels.name, name)));
    const [row] = await db.select().from(modelPrices).where(and(eq(modelPrices.channelModelId, model.id), eq(modelPrices.spec, spec)));
    return row.unitPrice;
}
beforeAll(async () => {
    // Refuse to touch a pre-existing provider channel, even if a test DB URL was misconfigured.
    const existing = await db.select().from(channels).where(eq(channels.baseUrl, "https://www.whatstoken.ai"));
    if (existing.length) throw new Error("Integration test needs a fresh isolated database");
    const result = await seedWhatsTokenChannel(db);
    channelId = result.id; ids.push(channelId);
});
afterAll(async () => { try { if (ids.length) await db.delete(channels).where(inArray(channels.id, ids)); } finally { await client.end({ timeout: 5 }); } });

describe("transactional channel repricing", () => {
    it("publishes all new models and snapshots tier/cache prices for exact settlement", async () => {
        const model = await pricing.resolvePublicModel(`${channelId}::gpt-6-astra-special`);
        expect(model.tokenPrices.tiers).toHaveLength(2);
        expect(model.tokenPrices.tiers![0].cacheWrite).toBe("17.550000");
        const frozen = await pricing.estimate({ model: model.value, inputTokens: 1000, maxOutputTokens: 1000 });
        expect(frozen.amount).toBe("0.087750");
        await repriceWhatsTokenChannel(db, channelId, "50"); await pricing.invalidate();
        expect(await price("gpt-6-astra-special", "input")).toBe("16.200000");
        expect(settleGenerationTask({ capability: "text", quantity: 2000, estimatedCost: frozen.amount, outputCount: 1, billingMode: "per_token", tokenPrices: frozen.tokenPrices, usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 900 } }).actualCost).toBe("0.009688");
    });
    it("serializes concurrent bulk changes, preserves customization and reports missing costs", async () => {
        const [custom] = await db.insert(channelModels).values({ channelId, name: `custom-${randomUUID()}`, displayName: "人工模型", capability: "text" }).returning();
        await db.insert(modelPrices).values({ channelModelId: custom.id, billingMode: "per_call", unitPrice: "0.123456" });
        const results = await Promise.all([repriceWhatsTokenChannel(db, channelId, "20"), repriceWhatsTokenChannel(db, channelId, "40")]);
        for (const result of results) expect(result.skipped.map((row) => row.model)).toContain("gemini-3.1-flash-lite-image");
        const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
        const expected = channel.markupPercent === "20.000000" ? "0.108864" : "0.127008";
        expect(await price("seedream-5.0-lite", "2K")).toBe(expected);
        expect((await db.select().from(modelPrices).where(eq(modelPrices.channelModelId, custom.id)))[0].unitPrice).toBe("0.123456");
        const first = await repriceWhatsTokenChannel(db, channelId, "30");
        const second = await repriceWhatsTokenChannel(db, channelId, "30");
        expect(second.pricesUpdated).toBe(first.pricesUpdated);
        expect(await price("seedream-5.0-lite", "2K")).toBe("0.117936");
    });
    it("uses channel-specific video rates and never applies provider floor to other channels", async () => {
        const [other] = await db.insert(channels).values({ name: "unrelated", baseUrl: "https://example.com" }).returning(); ids.push(other.id);
        const [model] = await db.insert(channelModels).values({ channelId: other.id, name: "seedance-2.0-self-developed-NSFW", capability: "video" }).returning();
        await db.insert(modelPrices).values({ channelModelId: model.id, billingMode: "per_second", unitPrice: "0.01" });
        await expect(repriceWhatsTokenChannel(db, other.id, "30")).rejects.toThrow("仅适用于");
        await pricing.invalidate();
        expect((await pricing.estimate({ model: `${other.id}::${model.name}`, seconds: 5, spec: "720" })).amount).toBe("0.050000");
        const own = await pricing.estimate({ model: `${channelId}::${model.name}`, seconds: 5, spec: "720", count: 2 }, { multiplier: "0.9" });
        const expected = seedanceTokensFor(720, 5).times(2).div(1_000_000).times("47.1744").times("0.9").toDecimalPlaces(6, 0).toFixed(6);
        expect(own.amount).toBe(expected);
        expect(own.videoTokenPrice).toBe("47.174400");
    });
    it("rolls back every row when a requested markup exceeds storage capacity", async () => {
        const before = await price("seedream-5.0-lite", "2K");
        await expect(repriceWhatsTokenChannel(db, channelId, "999999999999")).rejects.toThrow("超出金额存储范围");
        expect(await price("seedream-5.0-lite", "2K")).toBe(before);
    });
    it("does not resurrect removed models or overwrite existing image names/prices on restart", async () => {
        const [model] = await db.select().from(channelModels).where(and(eq(channelModels.channelId, channelId), eq(channelModels.name, "seedream-5.0-lite")));
        await db.update(channelModels).set({ displayName: "我的名字", enabled: false }).where(eq(channelModels.id, model.id));
        await db.update(modelPrices).set({ unitPrice: "0.25" }).where(eq(modelPrices.channelModelId, model.id));
        await db.delete(channelModels).where(and(eq(channelModels.channelId, channelId), eq(channelModels.name, "gpt-6-astra-special")));
        const result = await seedWhatsTokenChannel(db);
        expect(result.modelsCreated).toBe(0);
        expect(await price("seedream-5.0-lite", "2K")).toBe("0.250000");
        expect((await db.select().from(channelModels).where(eq(channelModels.id, model.id)))[0]).toMatchObject({ displayName: "我的名字", enabled: false });
    });
});
