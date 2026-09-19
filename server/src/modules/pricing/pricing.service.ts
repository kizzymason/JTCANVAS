import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import Redis from "ioredis";
import { DB, type Database } from "../../db/db.module";
import { channelModels, channels, modelPrices } from "../../db/schema";
import { badRequest, noUsableChannel } from "../../common/errors";
import { ceilMoney, money, mulMoney, toMoneyString } from "../../common/money";
import { seedanceCatalogSellCny } from "../generation/whatstoken-catalog";
import { REDIS } from "../../redis/redis.module";
import { parseModelFeatures } from "./model-features";
import {
    TOKEN_SPEC_INPUT,
    TOKEN_SPEC_OUTPUT,
    decodeModelValue,
    encodeModelValue,
    type Capability,
    type EstimateOptions,
    type EstimateRequest,
    type EstimateResult,
    type PublicModel,
} from "./pricing.types";
import { NEUTRAL_MULTIPLIER, applyMultiplier } from "./reseller-multiplier";
import { tokenBucketCost } from "./token-pricing";

const CACHE_KEY = "pricing:models:v2";
const CACHE_TTL_SECONDS = 600;

/**
 * Resolves prices and produces estimates. The public model table is cached in Redis because the
 * estimate endpoint is hit on every size/count change in the workbench, and invalidated whenever an
 * admin edits a channel, a model or a price.
 */
@Injectable()
export class PricingService {
    constructor(
        @Inject(DB) private readonly db: Database,
        @Inject(REDIS) private readonly redis: Redis,
    ) {}

    /** Enabled models across enabled channels, with prices attached. Safe to expose to any user. */
    async listPublicModels(): Promise<PublicModel[]> {
        const cached = await this.redis.get(CACHE_KEY);
        if (cached) return JSON.parse(cached) as PublicModel[];

        const rows = await this.db
            .select({
                channelId: channels.id,
                apiFormat: channels.apiFormat,
                priority: channels.priority,
                modelId: channelModels.id,
                modelName: channelModels.name,
                displayName: channelModels.displayName,
                capability: channelModels.capability,
                features: channelModels.features,
            })
            .from(channelModels)
            .innerJoin(channels, eq(channelModels.channelId, channels.id))
            .where(and(eq(channels.enabled, true), eq(channelModels.enabled, true)))
            .orderBy(asc(channels.priority), asc(channelModels.name));

        const prices = await this.db.select().from(modelPrices);
        const byModel = new Map<string, typeof prices>();
        for (const price of prices) {
            const list = byModel.get(price.channelModelId) ?? [];
            list.push(price);
            byModel.set(price.channelModelId, list);
        }

        const models: PublicModel[] = [];
        for (const row of rows) {
            const list = byModel.get(row.modelId) ?? [];
            // A model with no price row cannot be billed, so it must not be offered.
            if (!list.length) continue;
            const base = list.find((item) => item.spec === null) ?? list[0];
            const specPrices: Record<string, string> = {};
            for (const item of list) if (item.spec) specPrices[item.spec] = item.unitPrice;
            const tokenPrices = {
                input: specPrices[TOKEN_SPEC_INPUT] ?? "0",
                output: specPrices[TOKEN_SPEC_OUTPUT] ?? "0",
            };

            models.push({
                value: encodeModelValue(row.channelId, row.modelName),
                channelId: row.channelId,
                modelName: row.modelName,
                displayName: row.displayName || row.modelName,
                capability: row.capability,
                apiFormat: row.apiFormat,
                billingMode: base.billingMode,
                // Token models price input and output separately; the input rate is the headline number.
                unitPrice: base.billingMode === "per_token" ? tokenPrices.input : base.unitPrice,
                extraReferencePrice: base.extraReferencePrice,
                minCharge: base.minCharge,
                specPrices,
                tokenPrices,
                features: parseModelFeatures(row.features),
            });
        }

        await this.redis.set(CACHE_KEY, JSON.stringify(models), "EX", CACHE_TTL_SECONDS);
        return models;
    }

    async listByCapability(capability: Capability) {
        const models = await this.listPublicModels();
        return models.filter((model) => model.capability === capability);
    }

    /** Called after any admin mutation to channels, models or prices. */
    invalidate() {
        return this.redis.del(CACHE_KEY);
    }

    /**
     * Authoritative cost calculation. The frontend mirrors this for display, but the value the wallet
     * freezes always comes from here.
     *
     * `opts.multiplier` is the reseller coefficient. It is applied to the *final* amount, including the
     * Seedance catalogue floor, so a discounted reseller cannot be silently pulled back up to list
     * price by a fallback that only knows absolute CNY figures.
     */
    async estimate(request: EstimateRequest, opts?: EstimateOptions): Promise<EstimateResult> {
        const model = await this.resolveModel(request.model);
        const multiplier = opts?.multiplier ?? NEUTRAL_MULTIPLIER;
        if (model.billingMode === "per_token") return this.estimateTokens(model, request, multiplier);

        const price = this.priceFor(model, request.spec);
        const quantity = this.quantityFor(model.billingMode, request);

        const referenceSurcharge = mulMoney(price.extraReferencePrice, Math.max(0, (request.referenceCount ?? 0) - 1));
        const raw = mulMoney(price.unitPrice, quantity).plus(referenceSurcharge);
        let amount = ceilMoney(applyMultiplier(raw.lessThan(price.minCharge) ? price.minCharge : raw, multiplier));
        if (model.billingMode === "per_second") {
            const catalogSell = seedanceCatalogSellCny(model.modelName, request.spec, request.seconds ?? 0, request.count ?? 1);
            if (catalogSell) {
                const scaled = ceilMoney(applyMultiplier(catalogSell, multiplier));
                if (scaled.gt(amount)) amount = scaled;
            }
        }

        return {
            model: request.model,
            billingMode: model.billingMode,
            unitPrice: toMoneyString(applyMultiplier(price.unitPrice, multiplier)),
            quantity,
            amount: toMoneyString(amount),
            multiplier,
        };
    }

    /**
     * Text models bill on real usage, which is only known after the call. The freeze therefore uses the
     * output ceiling rather than a guess: settlement can then only ever come out lower, which keeps it
     * inside `WalletService.settle`'s "actual must not exceed frozen" rule.
     */
    private estimateTokens(model: PublicModel, request: EstimateRequest, multiplier: string): EstimateResult {
        const inputTokens = Math.max(0, Math.floor(request.inputTokens ?? 0));
        const maxOutputTokens = Math.max(0, Math.floor(request.maxOutputTokens ?? 0));
        if (inputTokens + maxOutputTokens < 1) throw badRequest("TOKENS_REQUIRED", "按 token 计费的模型需要提供输入与输出上限");

        const raw = tokenBucketCost(inputTokens, model.tokenPrices.input).plus(tokenBucketCost(maxOutputTokens, model.tokenPrices.output));
        const floored = raw.lessThan(model.minCharge) ? money(model.minCharge) : raw;

        return {
            model: request.model,
            billingMode: model.billingMode,
            unitPrice: toMoneyString(applyMultiplier(model.tokenPrices.input, multiplier)),
            quantity: inputTokens + maxOutputTokens,
            amount: toMoneyString(ceilMoney(applyMultiplier(floored, multiplier))),
            multiplier,
            inputTokens,
            maxOutputTokens,
        };
    }

    /** Full resolution including the decryptable channel row; worker-only. */
    async resolveForExecution(modelValue: string) {
        const { channelId, modelName } = decodeModelValue(modelValue);
        const rows = await this.db
            .select({ channel: channels, model: channelModels })
            .from(channelModels)
            .innerJoin(channels, eq(channelModels.channelId, channels.id))
            .where(channelId ? and(eq(channels.id, channelId), eq(channelModels.name, modelName)) : eq(channelModels.name, modelName))
            .orderBy(asc(channels.priority))
            .limit(1);
        if (!rows.length) throw noUsableChannel(`模型 ${modelName} 没有对应的可用渠道`);
        if (!rows[0].channel.enabled || !rows[0].model.enabled) throw noUsableChannel(`模型 ${modelName} 当前已停用`);
        return rows[0];
    }

    /** Public catalogue entry used by the API process to validate user-facing options. */
    async resolvePublicModel(modelValue: string) {
        return this.resolveModel(modelValue);
    }

    private async resolveModel(modelValue: string) {
        if (!modelValue?.trim()) throw badRequest("MODEL_REQUIRED", "请先选择模型");
        const models = await this.listPublicModels();
        const { channelId, modelName } = decodeModelValue(modelValue);
        const matched = channelId ? models.find((item) => item.channelId === channelId && item.modelName === modelName) : models.find((item) => item.modelName === modelName);
        if (!matched) throw noUsableChannel(`模型 ${modelName} 不可用，请重新选择`);
        return matched;
    }

    private priceFor(model: PublicModel, spec?: string) {
        return {
            unitPrice: lookupSpecPrice(model.specPrices, spec, model.unitPrice),
            extraReferencePrice: model.extraReferencePrice,
            minCharge: model.minCharge,
        };
    }

    private quantityFor(billingMode: PublicModel["billingMode"], request: EstimateRequest) {
        if (billingMode === "per_second") {
            const seconds = Math.ceil(request.seconds ?? 0);
            if (seconds < 1) throw badRequest("SECONDS_REQUIRED", "按秒计费的模型需要提供时长");
            // Multi-video requests multiply seconds by count.
            return seconds * Math.max(1, request.count ?? 1);
        }
        if (billingMode === "per_image") {
            const count = Math.floor(request.count ?? 1);
            if (count < 1) throw badRequest("COUNT_REQUIRED", "生成数量至少为 1");
            return count;
        }
        return Math.max(1, Math.floor(request.count ?? 1));
    }
}

/** PiAPI lite bills 3K where the shared quality map says 4K; pro clamps 3K/4K down to 2K. Video 含视 falls back to 无视 of the same resolution. */
function lookupSpecPrice(specPrices: Record<string, string>, spec: string | undefined, fallback: string) {
    if (!spec) return fallback;
    if (specPrices[spec]) return specPrices[spec];
    if (spec.endsWith("-video")) {
        const without = spec.slice(0, -"-video".length);
        if (specPrices[without]) return specPrices[without];
    }
    if (spec === "4K") return specPrices["3K"] ?? specPrices["2K"] ?? fallback;
    if (spec === "3K") return specPrices["2K"] ?? fallback;
    return fallback;
}
