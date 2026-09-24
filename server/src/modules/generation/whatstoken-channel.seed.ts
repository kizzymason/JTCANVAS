import { and, asc, eq, or, sql } from "drizzle-orm";
import type { Database, DbTransaction } from "../../db/db.module";
import { channelModels, channels, modelPrices } from "../../db/schema";
import { money } from "../../common/money";
import {
    WHATSTOKEN_BASE_URL,
    WHATSTOKEN_ADDED_MODEL_NAMES,
    isWhatsTokenChannel,
    WHATSTOKEN_CHANNEL_NAME,
    WHATSTOKEN_DURATION_VIDEO_MODELS,
    WHATSTOKEN_IMAGE_MODELS,
    WHATSTOKEN_TEXT_MODELS,
    WHATSTOKEN_VIDEO_MODELS,
    whatsTokenDurationVideoFeatures,
    whatsTokenDurationVideoPriceRows,
    whatsTokenImageFeatures,
    whatsTokenImagePriceRows,
    whatsTokenTextPriceRows,
    whatsTokenVideoFeatures,
    whatsTokenVideoPriceRows,
    type WhatsTokenSeedPriceRow,
} from "./whatstoken-catalog";
import { parseModelFeatures } from "../pricing/model-features";

export type WhatsTokenChannelSeedResult = {
    id: string;
    name: string;
    created: boolean;
    keyUpdated: boolean;
    modelsCreated: number;
    pricesInserted: number;
    pricesUpdated: number;
};

export type WhatsTokenSeedCrypto = {
    encrypt: (plaintext: string) => { cipher: string; keyId: string };
};

/**
 * Idempotent: one WhatsToken OpenAI channel, Seedream image + Seedance video models.
 * Image unit prices and display names are left alone so an admin tweak survives a restart.
 * Seedance video unit prices are rewritten from the encoder token formula (upstream $/M × 7.2 × 1.3)
 * so per-second freeze stays aligned with WhatsToken token billing.
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
        let pricesUpdated = 0;

        if (!isWhatsTokenChannel(channel)) throw new Error("WhatsToken 渠道地址与协议不匹配，请在渠道配置中检查");
        const existingModels = await tx.select().from(channelModels).where(eq(channelModels.channelId, channel.id));
        const firstSeed = !existingModels.length && channel.catalogueRevision === 0;
        const shouldAdd = (name: string) => firstSeed || (channel.catalogueRevision < 1 && WHATSTOKEN_ADDED_MODEL_NAMES.has(name));
        const markup = money(channel.markupPercent).div(100).plus(1).toString();
        for (const spec of WHATSTOKEN_IMAGE_MODELS) {
            if (!shouldAdd(spec.name)) continue;
            const result = await ensureModel(tx, channel.id, {
                name: spec.name,
                displayName: spec.displayName,
                capability: "image",
                features: whatsTokenImageFeatures(spec),
                prices: whatsTokenImagePriceRows(spec, markup),
                enabled: spec.enabled,
            });
            modelsCreated += result.created ? 1 : 0;
            pricesInserted += result.pricesInserted;
        }

        for (const spec of WHATSTOKEN_DURATION_VIDEO_MODELS) {
            if (!shouldAdd(spec.name)) continue;
            const result = await ensureModel(tx, channel.id, {
                name: spec.name,
                displayName: spec.displayName,
                capability: "video",
                features: whatsTokenDurationVideoFeatures(spec),
                prices: whatsTokenDurationVideoPriceRows(spec, markup),
                enabled: spec.enabled,
            });
            modelsCreated += result.created ? 1 : 0;
            pricesInserted += result.pricesInserted;
        }

        for (const spec of WHATSTOKEN_TEXT_MODELS) {
            if (!shouldAdd(spec.name)) continue;
            const result = await ensureModel(tx, channel.id, {
                name: spec.name,
                displayName: spec.displayName,
                capability: "text",
                features: parseModelFeatures({}),
                prices: whatsTokenTextPriceRows(spec, markup),
                enabled: spec.enabled,
            });
            modelsCreated += result.created ? 1 : 0;
            pricesInserted += result.pricesInserted;
        }

        for (const spec of WHATSTOKEN_VIDEO_MODELS) {
            if (!shouldAdd(spec.name) && !existingModels.some((model) => model.name === spec.name)) continue;
            const result = await ensureModel(
                tx,
                channel.id,
                {
                    name: spec.name,
                    displayName: spec.displayName,
                    capability: "video",
                    features: whatsTokenVideoFeatures(spec),
                    prices: whatsTokenVideoPriceRows(spec, markup),
                },
                true,
            );
            modelsCreated += result.created ? 1 : 0;
            pricesInserted += result.pricesInserted;
            pricesUpdated += result.pricesUpdated;
        }

        await tx.update(channels).set({ catalogueRevision: 1 }).where(eq(channels.id, channel.id));
        return { id: channel.id, name: channel.name, created, keyUpdated, modelsCreated, pricesInserted, pricesUpdated };
    });
}

async function ensureModel(
    tx: DbTransaction,
    channelId: string,
    spec: {
        name: string;
        displayName: string;
        capability: "image" | "video" | "text";
        features: Record<string, unknown>;
        prices: WhatsTokenSeedPriceRow[];
        /** Only applied on insert; an admin's later toggle is never overwritten. */
        enabled?: boolean;
    },
    syncPrices = false,
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
                enabled: spec.enabled ?? true,
                features: spec.features,
            })
            .returning();
        created = true;
    }

    const existing = await tx.select().from(modelPrices).where(eq(modelPrices.channelModelId, model.id));
    const bySpec = new Map(existing.map((row) => [row.spec ?? "", row]));
    let pricesInserted = 0;
    let pricesUpdated = 0;

    for (const row of spec.prices) {
        const key = row.spec ?? "";
        const current = bySpec.get(key);
        if (!current) {
            await tx.insert(modelPrices).values({
                channelModelId: model.id,
                billingMode: row.billingMode,
                spec: row.spec,
                unitPrice: row.unitPrice,
                extraReferencePrice: row.extraReferencePrice,
                minCharge: "0.000000",
            });
            pricesInserted += 1;
            continue;
        }
        if (!syncPrices) continue;
        if (current.unitPrice === row.unitPrice && current.billingMode === row.billingMode && current.extraReferencePrice === row.extraReferencePrice) {
            continue;
        }
        await tx
            .update(modelPrices)
            .set({
                unitPrice: row.unitPrice,
                extraReferencePrice: row.extraReferencePrice,
                billingMode: row.billingMode,
                updatedAt: new Date(),
            })
            .where(eq(modelPrices.id, current.id));
        pricesUpdated += 1;
    }

    return { created, pricesInserted, pricesUpdated };
}
