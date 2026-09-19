import Decimal from "decimal.js";
import { ceilMoney, money, toMoneyString, type MoneyInput } from "../../common/money";
import { TOKEN_PRICE_UNIT } from "./pricing.types";

export type TokenPrices = {
    /** CNY per 1M prompt tokens. */
    input: string;
    /** CNY per 1M completion tokens. */
    output: string;
};

export type TokenUsage = {
    inputTokens: number;
    outputTokens: number;
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
    return tokenBucketCost(usage.inputTokens, prices.input).plus(tokenBucketCost(usage.outputTokens, prices.output));
}

export function tokenUsageCostString(usage: TokenUsage, prices: TokenPrices) {
    return toMoneyString(ceilMoney(tokenUsageCost(usage, prices)));
}

export function hasTokenPrices(prices: TokenPrices | undefined): prices is TokenPrices {
    if (!prices) return false;
    return money(prices.input).gt(0) || money(prices.output).gt(0);
}
