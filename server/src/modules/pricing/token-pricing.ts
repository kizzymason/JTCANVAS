import Decimal from "decimal.js";
import { ceilMoney, money, toMoneyString, type MoneyInput } from "../../common/money";
import { TOKEN_PRICE_UNIT } from "./pricing.types";

export type TokenPrices = {
    /** CNY per 1M prompt tokens. */
    input: string;
    /** CNY per 1M completion tokens. */
    output: string;
    cacheRead?: string;
    cacheWrite?: string;
    tiers?: Array<{ maxInputTokens: number; input: string; output: string; cacheRead?: string; cacheWrite?: string }>;
    /** Daily UTC+8 peak windows. Rates are snapshotted; multiplier is evaluated at execution. */
    peakHours?: boolean;
};

export type TokenUsage = {
    inputTokens: number;
    outputTokens: number;
    /** Input total includes these non-overlapping cache buckets. */
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
};

export function normalizeTokenCount(value: unknown) {
    const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.floor(parsed);
}

/**
 * Cost of a token bucket. Prices are quoted per 1M tokens, so the division happens once here rather
 * than at every call site where a factor-of-a-million slip would be invisible.
 */
export function tokenBucketCost(tokens: number, pricePerMillion: MoneyInput): Decimal {
    const count = normalizeTokenCount(tokens);
    if (!count) return money(0);
    return money(pricePerMillion).times(count).div(TOKEN_PRICE_UNIT);
}

export function tokenUsageCost(usage: TokenUsage, prices: TokenPrices): Decimal {
    const rate = tokenTier(prices, usage.inputTokens);
    const input = normalizeTokenCount(usage.inputTokens);
    const read = Math.min(input, normalizeTokenCount(usage.cacheReadTokens));
    const write = Math.min(input - read, normalizeTokenCount(usage.cacheWriteTokens));
    return tokenBucketCost(input - read - write, rate.input)
        .plus(tokenBucketCost(read, rate.cacheRead ?? rate.input))
        .plus(tokenBucketCost(write, rate.cacheWrite ?? rate.input))
        .plus(tokenBucketCost(usage.outputTokens, rate.output));
}

export function tokenUsageCostString(usage: TokenUsage, prices: TokenPrices) {
    return toMoneyString(ceilMoney(tokenUsageCost(usage, prices)));
}

export function hasTokenPrices(prices: TokenPrices | undefined): prices is TokenPrices {
    if (!prices) return false;
    return money(prices.input).gt(0) || money(prices.output).gt(0);
}

export function tokenTier(prices: TokenPrices, inputTokens: number) {
    return prices.tiers?.find((tier) => inputTokens <= tier.maxInputTokens) ?? prices.tiers?.at(-1) ?? prices;
}

export function tokenTimeMultiplier(prices: TokenPrices, at = new Date()) {
    if (!prices.peakHours) return "1";
    const hour = new Date(at.getTime() + 8 * 60 * 60 * 1000).getUTCHours();
    return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18) ? "2" : "1";
}

/** Freeze cache writes at their higher rate and timed models at peak rate. */
export function tokenFreezeCost(inputTokens: number, outputTokens: number, prices: TokenPrices) {
    const rate = tokenTier(prices, inputTokens);
    const inputRate = Decimal.max(rate.input, rate.cacheWrite ?? rate.input, rate.cacheRead ?? rate.input);
    return tokenBucketCost(inputTokens, inputRate).plus(tokenBucketCost(outputTokens, rate.output)).times(prices.peakHours ? 2 : 1);
}

export function scaleTokenPrices(prices: TokenPrices, multiplier: string): TokenPrices {
    const rate = (p: TokenPrices) => ({ input: toMoneyString(money(p.input).times(multiplier)), output: toMoneyString(money(p.output).times(multiplier)),
        ...(p.cacheRead !== undefined ? { cacheRead: toMoneyString(money(p.cacheRead).times(multiplier)) } : {}),
        ...(p.cacheWrite !== undefined ? { cacheWrite: toMoneyString(money(p.cacheWrite).times(multiplier)) } : {}) });
    return { ...rate(prices), peakHours: prices.peakHours, tiers: prices.tiers?.map((tier) => ({ ...rate(tier), maxInputTokens: tier.maxInputTokens })) };
}
