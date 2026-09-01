import { and, asc, eq, or, sql } from "drizzle-orm";
import type { Database, DbTransaction } from "../../db/db.module";
import { channelModels, channels, modelPrices } from "../../db/schema";
import { isEmptyFeatures } from "../pricing/model-features";
import {
    WHATSTOKEN_BASE_URL,
    WHATSTOKEN_CHANNEL_NAME,
    WHATSTOKEN_IMAGE_MODELS,
    WHATSTOKEN_VIDEO_MODELS,
    whatsTokenImageFeatures,
    whatsTokenImagePriceRows,
    whatsTokenVideoFeatures,
    whatsTokenVideoPriceRows,
    type WhatsTokenSeedPriceRow,
} from "./whatstoken-catalog";

export type WhatsTokenChannelSeedResult = {
    id: string;
    name: string;
    created: boolean;
    keyUpdated: boolean;
    modelsCreated: number;
    pricesInserted: number;
};

export type WhatsTokenSeedCrypto = {
    encrypt: (plaintext: string) => { cipher: string; keyId: string };
};

/**
 * Idempotent: one WhatsToken OpenAI channel, Seedream image + Seedance video models, missing prices only.
 * Existing unit prices and API keys are left alone so an admin tweak survives a restart.
 */
export async function seedWhatsTokenChannel(
    db: Database,
    options?: { apiKey?: string; crypto?: WhatsTokenSeedCrypto },
): Promise<WhatsTokenChannelSeedResult> {
    return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('whatstoken.ensure-channel'))`);

        let [channel] = await tx
            .select()
            .from(channels)
            .where(or(eq(channels.name, WHATSTOKEN_CHANNEL_NAME), eq(channels.baseUrl, WHATSTOKEN_BASE_URL)))
            .orderBy(asc(channels.priority))
            .limit(1);

        let created = false;
        let keyUpdated = false;
        if (!channel) {
            const encrypted = options?.apiKey && options.crypto ? options.crypto.encrypt(options.apiKey) : { cipher: "", keyId: "" };
            [channel] = await tx
                .insert(channels)
                .values({
                    name: WHATSTOKEN_CHANNEL_NAME,
                    baseUrl: WHATSTOKEN_BASE_URL,
                    apiFormat: "openai",
                    apiKeyCipher: encrypted.cipher,
                    apiKeyId: encrypted.keyId,
                    enabled: true,
                    priority: 10,
                })
                .returning();
            created = true;
            keyUpdated = Boolean(encrypted.cipher);
        } else if (!channel.apiKeyCipher && options?.apiKey && options.crypto) {
            const encrypted = options.crypto.encrypt(options.apiKey);
            [channel] = await tx
                .update(channels)
                .set({ apiKeyCipher: encrypted.cipher, apiKeyId: encrypted.keyId, updatedAt: new Date() })
                .where(eq(channels.id, channel.id))
                .returning();
            keyUpdated = true;
        }

        let modelsCreated = 0;
        let pricesInserted = 0;

        for (const spec of WHATSTOKEN_IMAGE_MODELS) {
            const result = await ensureModel(tx, channel.id, {
                name: spec.name,
                displayName: spec.displayName,
                capability: "image",
                features: whatsTokenImageFeatures(spec),
                prices: whatsTokenImagePriceRows(spec),
            });
            modelsCreated += result.created ? 1 : 0;
            pricesInserted += result.pricesInserted;
        }

        for (const spec of WHATSTOKEN_VIDEO_MODELS) {
            const result = await ensureModel(tx, channel.id, {
                name: spec.name,
                displayName: spec.displayName,
                capability: "video",
                features: whatsTokenVideoFeatures(spec),
                prices: whatsTokenVideoPriceRows(spec),
            });
            modelsCreated += result.created ? 1 : 0;
            pricesInserted += result.pricesInserted;
        }

        return { id: channel.id, name: channel.name, created, keyUpdated, modelsCreated, pricesInserted };
    });
}

async function ensureModel(
    tx: DbTransaction,
    channelId: string,
    spec: {
        name: string;
        displayName: string;
        capability: "image" | "video";
        features: Record<string, unknown>;
        prices: WhatsTokenSeedPriceRow[];
    },
) {
    let [model] = await tx
        .select()
        .from(channelModels)
        .where(and(eq(channelModels.channelId, channelId), eq(channelModels.name, spec.name)))
        .limit(1);

    let created = false;
    if (!model) {
        [model] = await tx
            .insert(channelModels)
            .values({
                channelId,
                name: spec.name,
                displayName: spec.displayName,
                capability: spec.capability,
                enabled: true,
                features: spec.features,
            })
            .returning();
        created = true;
    } else if (isEmptyFeatures(model.features)) {
        [model] = await tx
            .update(channelModels)
            .set({ features: spec.features, updatedAt: new Date() })
            .where(eq(channelModels.id, model.id))
            .returning();
    }

    const existing = await tx.select({ spec: modelPrices.spec }).from(modelPrices).where(eq(modelPrices.channelModelId, model.id));
    const have = new Set(existing.map((row) => row.spec ?? ""));
    let pricesInserted = 0;

    for (const row of spec.prices) {
        const key = row.spec ?? "";
        if (have.has(key)) continue;
        await tx.insert(modelPrices).values({
            channelModelId: model.id,
            billingMode: row.billingMode,
            spec: row.spec,
            unitPrice: row.unitPrice,
            extraReferencePrice: row.extraReferencePrice,
            minCharge: "0.000000",
        });
        pricesInserted += 1;
        have.add(key);
    }

    return { created, pricesInserted };
}
