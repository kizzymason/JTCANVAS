import Decimal from "decimal.js";

/**
 * Money is stored as PostgreSQL NUMERIC(18,6) in CNY and travels through the app as a decimal string.
 * Arithmetic that changes a balance always happens in SQL; these helpers exist only for comparison,
 * derivation of an amount to send to SQL, and formatting. Never convert money to `number`.
 */
export const MONEY_SCALE = 6;

// decimal.js defaults to 20 significant digits, which is plenty for NUMERIC(18,6).
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = string | number | Decimal;

export function money(value: MoneyInput): Decimal {
    // A number input is only tolerated for literals in pricing math; it never comes from the database.
    return value instanceof Decimal ? value : new Decimal(value);
}

/** Serialise for a NUMERIC column: fixed scale, no exponent notation. */
export function toMoneyString(value: MoneyInput) {
    return money(value).toFixed(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

/** Round up to the storage scale so we never under-charge by a rounding remainder. */
export function ceilMoney(value: MoneyInput) {
    return money(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_UP);
}

export function isNegative(value: MoneyInput) {
    return money(value).isNegative();
}

export function gte(a: MoneyInput, b: MoneyInput) {
    return money(a).gte(money(b));
}

export function addMoney(...values: MoneyInput[]) {
    return values.reduce<Decimal>((total, value) => total.plus(money(value)), new Decimal(0));
}

export function subMoney(a: MoneyInput, b: MoneyInput) {
    return money(a).minus(money(b));
}

export function mulMoney(a: MoneyInput, factor: MoneyInput) {
    return money(a).times(money(factor));
}

/** Display value for UI and exports: two decimals is the CNY convention. */
export function formatMoney(value: MoneyInput) {
    return money(value).toFixed(2, Decimal.ROUND_HALF_UP);
}

export const ZERO_MONEY = toMoneyString(0);
