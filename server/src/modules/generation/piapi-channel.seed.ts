import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/db.module";
import { channelModels, channels, modelPrices } from "../../db/schema";
import { isEmptyFeatures } from "../pricing/model-features";
import { PIAPI_BASE_URL, PIAPI_SEEDREAM_MODELS, piapiSeedFeatures, piapiSeedPriceRows } from "./piapi-catalog";

export type PiapiChannelSeedResult = {
    id: string;
    name: string;
    created: boolean;
    modelsCreated: number;
    pricesInserted: number;
};

/**
 * Idempotent: one PiAPI channel, four Seedream image models, and missing price rows only.
 * Existing unit prices are left alone so an admin tweak survives a restart.
 */
export async function seedPiapiChannel(db: Database): Promise<PiapiChannelSeedResult> {
    return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('piapi.ensure-channel'))`);

        let [channel] = await tx.select().from(channels).where(eq(channels.apiFormat, "piapi")).orderBy(asc(channels.priority)).limit(1);
        let created = false;
        if (!channel) {
            [channel] = await tx
                .insert(channels)
                .values({
                    name: "PiAPI",
                    baseUrl: PIAPI_BASE_URL,
                    apiFormat: "piapi",
                    apiKeyCipher: "",
                    apiKeyId: "",
                    enabled: true,
                    priority: 1,
                })
                .returning();
            created = true;
        }

        let modelsCreated = 0;
        let pricesInserted = 0;

        for (const spec of PIAPI_SEEDREAM_MODELS) {
            let [model] = await tx
                .select()
                .from(channelModels)
                .where(and(eq(channelModels.channelId, channel.id), eq(channelModels.name, spec.name)))
                .limit(1);

            if (!model) {
                [model] = await tx
                    .insert(channelModels)
                    .values({
                        channelId: channel.id,
                        name: spec.name,
                        displayName: spec.displayName,
                        capability: "image",
                        enabled: true,
                        features: piapiSeedFeatures(spec),
                    })
                    .returning();
                modelsCreated += 1;
            } else if (isEmptyFeatures(model.features)) {
                [model] = await tx
                    .update(channelModels)
                    .set({ features: piapiSeedFeatures(spec), updatedAt: new Date() })
                    .where(eq(channelModels.id, model.id))
                    .returning();
            }

            const existing = await tx.select({ spec: modelPrices.spec }).from(modelPrices).where(eq(modelPrices.channelModelId, model.id));
            const have = new Set(existing.map((row) => row.spec ?? ""));

            for (const row of piapiSeedPriceRows(spec)) {
                const key = row.spec ?? "";
                if (have.has(key)) continue;
                await tx.insert(modelPrices).values({
                    channelModelId: model.id,
                    billingMode: "per_image",
                    spec: row.spec,
                    unitPrice: row.unitPrice,
                    extraReferencePrice: row.extraReferencePrice,
                    minCharge: "0.000000",
                });
                pricesInserted += 1;
                have.add(key);
            }
        }

        return { id: channel.id, name: channel.name, created, modelsCreated, pricesInserted };
    });
}
