import { asc, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/db.module";
import { channelModels, channels, modelPrices } from "../../db/schema";
import { PIAPI_BASE_URL, PIAPI_SEEDREAM_MODELS, piapiSeedFeatures, piapiSeedPriceRows, shouldWritePiapiPresetCatalog } from "./piapi-catalog";

export type PiapiChannelSeedResult = {
    id: string;
    name: string;
    created: boolean;
    modelsCreated: number;
    pricesInserted: number;
};

/**
 * Ensures one PiAPI channel exists.
 * The four Seedream presets are written only when no PiAPI channel has any models yet.
 * After an admin has added, renamed, repriced or deleted models, restarts must not
 * recreate presets or mutate display names, features or prices.
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

        const [owned] = await tx
            .select({ id: channelModels.id })
            .from(channelModels)
            .innerJoin(channels, eq(channelModels.channelId, channels.id))
            .where(eq(channels.apiFormat, "piapi"))
            .limit(1);

        if (!shouldWritePiapiPresetCatalog(owned ? 1 : 0)) {
            return { id: channel.id, name: channel.name, created, modelsCreated: 0, pricesInserted: 0 };
        }

        let modelsCreated = 0;
        let pricesInserted = 0;

        for (const spec of PIAPI_SEEDREAM_MODELS) {
            const [model] = await tx
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

            for (const row of piapiSeedPriceRows(spec)) {
                await tx.insert(modelPrices).values({
                    channelModelId: model.id,
                    billingMode: "per_image",
                    spec: row.spec,
                    unitPrice: row.unitPrice,
                    extraReferencePrice: row.extraReferencePrice,
                    minCharge: "0.000000",
                });
                pricesInserted += 1;
            }
        }

        return { id: channel.id, name: channel.name, created, modelsCreated, pricesInserted };
    });
}
