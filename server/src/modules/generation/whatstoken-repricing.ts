import { eq, sql } from "drizzle-orm";
import type { Database } from "../../db/db.module";
import { channelModels, channels, modelPrices } from "../../db/schema";
import { badRequest, notFound } from "../../common/errors";
import { money } from "../../common/money";
import { isWhatsTokenChannel, WHATSTOKEN_IMAGE_MODELS, WHATSTOKEN_VIDEO_MODELS, WHATSTOKEN_DURATION_VIDEO_MODELS, WHATSTOKEN_TEXT_MODELS, whatsTokenImagePriceRows, whatsTokenVideoPriceRows, whatsTokenDurationVideoPriceRows, whatsTokenTextPriceRows, type WhatsTokenSeedPriceRow } from "./whatstoken-catalog";

export function catalogPriceRows(name: string, markup: string): WhatsTokenSeedPriceRow[] | undefined {
    const image = WHATSTOKEN_IMAGE_MODELS.find((model) => model.name === name);
    if (image) return image.sizesCny ? undefined : whatsTokenImagePriceRows(image, markup);
    const video = WHATSTOKEN_VIDEO_MODELS.find((model) => model.name === name);
    if (video) return whatsTokenVideoPriceRows(video, markup);
    const duration = WHATSTOKEN_DURATION_VIDEO_MODELS.find((model) => model.name === name);
    if (duration) return whatsTokenDurationVideoPriceRows(duration, markup);
    const text = WHATSTOKEN_TEXT_MODELS.find((model) => model.name === name);
    return text ? whatsTokenTextPriceRows(text, markup) : undefined;
}

export async function repriceWhatsTokenChannel(db: Database, channelId: string, markupPercent: string) {
    return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('whatstoken.ensure-channel'))`);
        const [channel] = await tx.select().from(channels).where(eq(channels.id, channelId)).for("update");
        if (!channel) throw notFound("渠道不存在");
        if (!isWhatsTokenChannel(channel)) throw badRequest("CHANNEL_REPRICING_UNSUPPORTED", "该操作仅适用于 WhatsToken 渠道");
        const percent = money(markupPercent);
        if (!percent.isFinite() || percent.isNegative()) throw badRequest("INVALID_MARKUP", "加价幅度必须为非负数");
        const factor = percent.div(100).plus(1).toString();
        const models = await tx.select().from(channelModels).where(eq(channelModels.channelId, channelId));
        const changes: Array<{ model: string; spec: string | null; before: unknown; after: unknown }> = [];
        const skipped: Array<{ model: string; reason: string }> = [];
        let modelsUpdated = 0;
        for (const model of models) {
            const desired = catalogPriceRows(model.name, factor);
            if (!desired) { skipped.push({ model: model.name, reason: "缺少可核实成本，保留现价" }); continue; }
            if (desired.some((row) => money(row.unitPrice).gte("1000000000000") || money(row.extraReferencePrice).gte("1000000000000"))) {
                throw badRequest("PRICE_STORAGE_OVERFLOW", "重新计算的价格超出金额存储范围，请降低加价幅度");
            }
            const current = await tx.select().from(modelPrices).where(eq(modelPrices.channelModelId, model.id)).for("update");
            const unknown = current.filter((price) => !desired.some((row) => row.spec === price.spec));
            if (unknown.length) { skipped.push({ model: model.name, reason: "存在自定义规格，需补齐成本后重新定价" }); continue; }
            for (const row of desired) {
                const previous = current.filter((price) => price.spec === row.spec);
                const before = previous.map(({ unitPrice, extraReferencePrice, minCharge, billingMode }) => ({ unitPrice, extraReferencePrice, minCharge, billingMode }));
                // Minimum charge is an explicit admin rule and is preserved.
                if (previous.length) {
                    for (const price of previous) await tx.update(modelPrices).set({ ...row, updatedAt: new Date() }).where(eq(modelPrices.id, price.id));
                } else await tx.insert(modelPrices).values({ ...row, channelModelId: model.id });
                changes.push({ model: model.name, spec: row.spec, before, after: row });
            }
            modelsUpdated++;
        }
        await tx.update(channels).set({ markupPercent: percent.toFixed(6), updatedAt: new Date() }).where(eq(channels.id, channelId));
        return { modelsUpdated, pricesUpdated: changes.length, skipped, markupPercent: percent.toFixed(6),
            audit: { targetId: channelId, before: { markupPercent: channel.markupPercent }, after: { markupPercent: percent.toFixed(6), changes, skipped } } };
    });
}
