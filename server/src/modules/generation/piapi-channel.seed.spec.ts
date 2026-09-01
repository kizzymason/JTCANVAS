import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgClient, type Database } from "../../db/db.module";
import * as schema from "../../db/schema";
import { channelModels, channels, modelPrices } from "../../db/schema";
import { seedPiapiChannel } from "./piapi-channel.seed";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://infinite:infinite@127.0.0.1:5442/infinite_canvas";
const CUSTOM_PRO_LABEL = "Seedream 5 Pro [低价A渠道][推荐]";
const CUSTOM_PRICE = "0.010000";

let client: postgres.Sql;
let db: Database;

beforeAll(async () => {
    client = createPgClient(DATABASE_URL, 10);
    db = drizzle(client, { schema });
    await db.execute(sql`select 1`);
});

afterAll(async () => {
    await client.end({ timeout: 5 });
});

describe("seedPiapiChannel", () => {
    it("does not recreate deleted presets or rewrite admin labels and prices", async () => {
        await seedPiapiChannel(db);
        const [channel] = await db.select().from(channels).where(eq(channels.apiFormat, "piapi")).orderBy(asc(channels.priority)).limit(1);
        expect(channel).toBeTruthy();

        const [pro] = await db
            .select()
            .from(channelModels)
            .where(and(eq(channelModels.channelId, channel.id), eq(channelModels.name, "seedream-5-pro")))
            .limit(1);
        const [lite] = await db
            .select()
            .from(channelModels)
            .where(and(eq(channelModels.channelId, channel.id), eq(channelModels.name, "seedream-5-lite")))
            .limit(1);

        const previousProName = pro?.displayName;
        const [previousPrice] = pro
            ? await db.select().from(modelPrices).where(eq(modelPrices.channelModelId, pro.id)).limit(1)
            : [];
        const litePrices = lite ? await db.select().from(modelPrices).where(eq(modelPrices.channelModelId, lite.id)) : [];

        try {
            if (pro && previousPrice) {
                await db.update(channelModels).set({ displayName: CUSTOM_PRO_LABEL, updatedAt: new Date() }).where(eq(channelModels.id, pro.id));
                await db.update(modelPrices).set({ unitPrice: CUSTOM_PRICE, updatedAt: new Date() }).where(eq(modelPrices.id, previousPrice.id));
            }
            if (lite) {
                await db.delete(channelModels).where(eq(channelModels.id, lite.id));
            }

            const remaining = await db.select({ id: channelModels.id }).from(channelModels).where(eq(channelModels.channelId, channel.id)).limit(1);
            if (!remaining.length) {
                await db.insert(channelModels).values({
                    channelId: channel.id,
                    name: "seed-test-keep-catalog-owned",
                    displayName: "Seedream 5 Lite [低价A渠道]",
                    capability: "image",
                    enabled: true,
                    features: {},
                });
            }

            const result = await seedPiapiChannel(db);
            expect(result.modelsCreated).toBe(0);
            expect(result.pricesInserted).toBe(0);

            const [liteAfter] = await db
                .select()
                .from(channelModels)
                .where(and(eq(channelModels.channelId, channel.id), eq(channelModels.name, "seedream-5-lite")))
                .limit(1);
            expect(liteAfter).toBeUndefined();

            if (pro && previousPrice) {
                const [proAfter] = await db.select().from(channelModels).where(eq(channelModels.id, pro.id)).limit(1);
                const [priceAfter] = await db.select().from(modelPrices).where(eq(modelPrices.id, previousPrice.id)).limit(1);
                expect(proAfter?.displayName).toBe(CUSTOM_PRO_LABEL);
                expect(priceAfter?.unitPrice).toBe(CUSTOM_PRICE);
            }

            const vanilla = await db
                .select({ id: channelModels.id })
                .from(channelModels)
                .where(and(eq(channelModels.channelId, channel.id), eq(channelModels.displayName, "Seedream 5 Lite")));
            expect(vanilla.length).toBe(0);
        } finally {
            await db.delete(channelModels).where(and(eq(channelModels.channelId, channel.id), eq(channelModels.name, "seed-test-keep-catalog-owned")));
            if (pro && previousProName && previousPrice) {
                await db.update(channelModels).set({ displayName: previousProName, updatedAt: new Date() }).where(eq(channelModels.id, pro.id));
                await db.update(modelPrices).set({ unitPrice: previousPrice.unitPrice, updatedAt: new Date() }).where(eq(modelPrices.id, previousPrice.id));
            }
            if (lite) {
                const [restored] = await db
                    .select()
                    .from(channelModels)
                    .where(and(eq(channelModels.channelId, channel.id), eq(channelModels.name, "seedream-5-lite")))
                    .limit(1);
                if (!restored) {
                    const [row] = await db
                        .insert(channelModels)
                        .values({
                            id: lite.id,
                            channelId: lite.channelId,
                            name: lite.name,
                            displayName: lite.displayName,
                            capability: lite.capability,
                            enabled: lite.enabled,
                            script: lite.script,
                            features: lite.features,
                        })
                        .returning();
                    if (litePrices.length) {
                        await db.insert(modelPrices).values(
                            litePrices.map((price) => ({
                                id: price.id,
                                channelModelId: row.id,
                                billingMode: price.billingMode,
                                spec: price.spec,
                                unitPrice: price.unitPrice,
                                extraReferencePrice: price.extraReferencePrice,
                                minCharge: price.minCharge,
                            })),
                        );
                    }
                }
            }
        }
    });
});
