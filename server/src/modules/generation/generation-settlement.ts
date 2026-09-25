import { ceilMoney, money, mulMoney, toMoneyString } from "../../common/money";
import { applyMultiplier } from "../pricing/reseller-multiplier";
import { tokenUsageCost, type TokenPrices, type TokenUsage } from "../pricing/token-pricing";
import { seedanceSellCnyFromTokens } from "./whatstoken-catalog";

export type GenerationSettlementInput = {
    capability: string;
    /** Requested billable units: images/calls, or seconds × video count. */
    quantity: number;
    estimatedCost: string;
    /** Persisted outputs (files) or 1 when text was produced. */
    outputCount: number;
    /** Provider-reported billable units. For video this is seconds, not file count. */
    actualQuantity?: number;
    /** Upstream completion tokens when the provider reports them. */
    usageTokens?: number;
    /** Token volume used to freeze this task (encoder formula × clip count). */
    estimatedTokens?: number;
    /** Published $/1M for this Seedance spec; used with usageTokens to settle. */
    upstreamUsdPerM?: string;
    videoTokenPrice?: string;
    tokenTimeMultiplier?: string;
    /**
     * Reseller coefficient snapshotted at submit time. Required wherever settlement derives an
     * absolute CNY figure from a public price list, because those figures are quoted at list price and
     * would otherwise silently undo the reseller's markup or discount.
     */
    billingMultiplier?: string;
    /** `per_token` billing: settle on the usage the upstream actually reported. */
    billingMode?: string;
    tokenPrices?: TokenPrices;
    usage?: TokenUsage;
};

export type GenerationSettlement = {
    status: "succeeded" | "partial" | "failed";
    succeededCount: number;
    actualCost: string;
};

/**
 * Wallet settlement for a finished generation task.
 *
 * Video `quantity` is seconds (× count). A single successful clip must bill those
 * seconds, not `1 / seconds` of the freeze. Images still pro-rate by file count.
 *
 * Seedance is priced per second from an encoder token formula. When the upstream
 * returns completion tokens, settle from tokens × $/M × 7.2 × 1.3, never above the freeze.
 */
export function settleGenerationTask(input: GenerationSettlementInput): GenerationSettlement {
    const requested = Math.max(1, Math.floor(input.quantity));
    const outputCount = Math.max(0, Math.floor(input.outputCount));

    if (input.capability === "video") {
        if (outputCount < 1) return failed();
        const billed = billedVideoSeconds(input.actualQuantity, requested);
        return {
            status: billed >= requested ? "succeeded" : "partial",
            succeededCount: billed,
            actualCost: videoActualCost(input, requested, billed),
        };
    }

    if (outputCount < 1) return failed();

    if (input.billingMode === "per_token") {
        return { status: "succeeded", succeededCount: outputCount, actualCost: tokenActualCost(input) };
    }

    const billed = clampUnits(input.actualQuantity ?? outputCount, requested);
    return {
        status: billed >= requested ? "succeeded" : "partial",
        succeededCount: outputCount,
        actualCost: proRate(input.estimatedCost, requested, billed),
    };
}

/** Ark's Seedance floor. A reported quantity below this is a clip count, not seconds. */
export const MIN_VIDEO_SECONDS = 4;

/**
 * Billable units for a finished video task.
 *
 * Adapters normally report seconds, but a clip count (1 per delivered clip) has shown up as well:
 * six tasks on 2026-09-02 reported 1 for a 10s clip, so the customer was charged 1/10 of what the
 * upstream charged us. Anything below the 4s floor therefore falls back to the per-clip seconds
 * recorded on the task.
 */
export function videoBillableQuantity(reported: number | undefined, params: Record<string, unknown> | undefined, quantity: number, outputCount: number) {
    if (reported != null && Number.isFinite(reported) && reported >= MIN_VIDEO_SECONDS) return reported;
    return videoSecondsFromParams(params, quantity, outputCount);
}

/** Seconds to bill when the adapter omitted `actualQuantity` but we have N clips. */
export function videoSecondsFromParams(params: Record<string, unknown> | undefined, quantity: number, outputCount: number) {
    const seconds = Math.floor(Number(params?.seconds ?? 0));
    if (seconds >= 1) return seconds * Math.max(1, outputCount);
    const count = Math.max(1, Math.floor(Number(params?.count ?? 1)));
    const perClip = Math.max(1, Math.floor(quantity / count));
    return perClip * Math.max(1, outputCount);
}

function billedVideoSeconds(actualQuantity: number | undefined, requested: number) {
    if (actualQuantity == null || !Number.isFinite(actualQuantity)) return requested;
    const billed = Math.floor(actualQuantity);
    if (billed < 1) return requested;
    return Math.min(billed, requested);
}

function clampUnits(value: number, requested: number) {
    const billed = Math.floor(value);
    if (!Number.isFinite(billed) || billed < 1) return requested;
    return Math.min(billed, requested);
}

function proRate(estimatedCost: string, requested: number, billed: number) {
    if (billed >= requested) return toMoneyString(estimatedCost);
    return toMoneyString(ceilMoney(mulMoney(estimatedCost, billed).div(requested)));
}

/**
 * `per_token` freezes the output ceiling, so the real usage can only ever come out lower. The cap
 * against the freeze is belt-and-braces: it keeps the settle inside `WalletService.settle`'s
 * "actual must not exceed frozen" rule even if a provider reports more tokens than it was allowed.
 */
function tokenActualCost(input: GenerationSettlementInput) {
    if (!input.usage || !input.tokenPrices) return toMoneyString(input.estimatedCost);
    const raw = ceilMoney(applyMultiplier(tokenUsageCost(input.usage, input.tokenPrices).times(input.tokenTimeMultiplier ?? "1"), input.billingMultiplier));
    return raw.lt(input.estimatedCost) ? toMoneyString(raw) : toMoneyString(input.estimatedCost);
}

function videoActualCost(input: GenerationSettlementInput, requested: number, billed: number) {
    // Token-billed video: the relay's usage is the truth, so bill it whenever it was reported and
    // fall back to the seconds pro-rate only when the provider sent none. The freeze stays the hard
    // ceiling because `WalletService.settle` cannot release more than was frozen.
    const tokenCost = seedanceTokenSell(input) ?? proRate(input.estimatedCost, requested, billed);
    return money(tokenCost).lt(money(input.estimatedCost)) ? tokenCost : toMoneyString(input.estimatedCost);
}

function seedanceTokenSell(input: GenerationSettlementInput) {
    const usageTokens = asTokenCount(input.usageTokens);
    if (!usageTokens) return undefined;
    if (input.videoTokenPrice) return toMoneyString(ceilMoney(applyMultiplier(money(usageTokens).div(1_000_000).times(input.videoTokenPrice), input.billingMultiplier)));
    const usdPerM = (input.upstreamUsdPerM ?? "").trim();
    // The catalogue quotes list price, so the reseller coefficient has to be re-applied here.
    if (usdPerM) return toMoneyString(ceilMoney(applyMultiplier(seedanceSellCnyFromTokens(usdPerM, usageTokens), input.billingMultiplier)));
    const estimatedTokens = asTokenCount(input.estimatedTokens);
    if (!estimatedTokens) return undefined;
    // Scaling the freeze needs no coefficient: `estimatedCost` already carries it.
    return toMoneyString(ceilMoney(mulMoney(input.estimatedCost, usageTokens).div(estimatedTokens)));
}

function asTokenCount(value: number | undefined) {
    if (value == null || !Number.isFinite(value) || value < 1) return undefined;
    return Math.floor(value);
}

function failed(): GenerationSettlement {
    return { status: "failed", succeededCount: 0, actualCost: toMoneyString(0) };
}
