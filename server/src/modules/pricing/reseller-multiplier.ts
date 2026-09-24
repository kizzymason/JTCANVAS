import { money, toMoneyString, type MoneyInput } from "../../common/money";

/** Coefficient applied when no reseller pricing is in play: the public price, unchanged. */
export const NEUTRAL_MULTIPLIER = toMoneyString(1);

/**
 * A tier stores the *surcharge*, not the coefficient: 0.2 means "20% above the public price" and
 * -0.2 means "20% off". Existing approved pricing remains valid during and after tier review; an explicit
 * per-account override always beats the tier it belongs to.
 */
export type MultiplierSource = {
    /** Null when the account never applied, which is normal for an admin using the console. */
    status: string | null | undefined;
    /** Per-account override; null or empty means inherit the tier. */
    multiplierOverride?: string | null;
    tierMultiplier?: string | null;
};

/** Turns a signed surcharge into the coefficient the pricing math multiplies by. */
export function coefficientFromSurcharge(surcharge: MoneyInput) {
    const value = money(1).plus(money(surcharge));
    // A surcharge of -1 or lower would make generation free or negative; clamp to zero instead.
    return toMoneyString(value.isNegative() ? 0 : value);
}

export function effectiveMultiplier(source: MultiplierSource | null | undefined) {
    // Review never changes the existing price; only an administrator changes the tier/override.
    if (!source || !["approved", "pending", "rejected"].includes(source.status ?? "")) return NEUTRAL_MULTIPLIER;
    const override = source.multiplierOverride;
    if (override !== null && override !== undefined && override !== "") return coefficientFromSurcharge(override);
    if (source.tierMultiplier) return coefficientFromSurcharge(source.tierMultiplier);
    return NEUTRAL_MULTIPLIER;
}

export function isNeutralMultiplier(multiplier: string | undefined) {
    if (!multiplier) return true;
    return money(multiplier).eq(1);
}

/** Applies a coefficient, tolerating an absent or neutral one so callers need no branching. */
export function applyMultiplier(amount: MoneyInput, multiplier: string | undefined) {
    if (isNeutralMultiplier(multiplier)) return money(amount);
    return money(amount).times(money(multiplier!));
}
