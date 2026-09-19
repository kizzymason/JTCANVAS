import { badRequest } from "../../common/errors";
import { gte, minMoney, mulMoney, subMoney, toMoneyString } from "../../common/money";

/**
 * Pure decision rules for sales channels: commission arithmetic and return-URL validation.
 *
 * Split out from the service because both are money- and security-critical and neither needs a
 * database, so they can be tested exhaustively on their own.
 */

export type CommissionTerms = { commissionMode: "rate" | "fixed"; commissionRate: string };

/**
 * Commission on one sale.
 *
 * Capped at the settled amount: a fat-fingered fixed rate or a 100% share must never make us owe a
 * channel more than the buyer actually paid, because the payout comes out of that same money.
 */
export function commissionFor(terms: CommissionTerms, params: { amount: string; quantity: number }) {
    const raw = terms.commissionMode === "fixed" ? mulMoney(terms.commissionRate, params.quantity) : mulMoney(params.amount, terms.commissionRate);
    return toMoneyString(minMoney(raw, params.amount));
}

/**
 * Whether one more sale of `amount` fits inside the channel's daily ceiling.
 *
 * The cap is the most useful control we have against a payment-provider review: what draws attention
 * is a merchant account whose daily volume jumps by an order of magnitude overnight. `soldToday`
 * deliberately includes unpaid checkouts, or a channel could open unlimited ones and let them all
 * settle at once, sailing straight past the ceiling.
 */
export function fitsDailyLimit(params: { dailySalesLimit: string; soldToday: string; amount: string }) {
    if (!Number.isFinite(Number(params.dailySalesLimit))) return false;
    if (Number(params.dailySalesLimit) <= 0) return true;
    return gte(subMoney(params.dailySalesLimit, params.soldToday), params.amount);
}

/** When a commission earned now becomes payable. */
export function commissionPayableAt(paidAt: Date, holdDays: number) {
    return new Date(paidAt.getTime() + Math.max(0, holdDays) * 24 * 60 * 60 * 1000);
}

/**
 * Picks where to send the buyer after paying.
 *
 * The candidate must match a URL an admin approved for this channel. Taking the caller's word for it
 * would turn our payment callback into an open redirect that anyone holding a channel key could aim
 * anywhere — including at a phishing copy of the buyer's own shop.
 */
export function resolveReturnUrl(merchant: { returnUrls: string[] }, requested?: string) {
    const allowed = merchant.returnUrls.filter(Boolean);
    if (!allowed.length) return "";
    const candidate = (requested ?? "").trim();
    if (!candidate) return allowed[0]!;
    if (allowed.some((entry) => isWithin(entry, candidate))) return candidate;
    throw badRequest("MERCHANT_RETURN_URL_FORBIDDEN", "回跳地址不在该渠道已登记的白名单内");
}

/**
 * True when `candidate` is the approved entry or sits underneath it.
 *
 * Origin must match exactly, so a different scheme, port or a lookalike host such as
 * `shop.example.com.evil.test` is rejected. The path is compared by segment rather than by prefix,
 * otherwise an approved `/pay` would also authorise `/payments-of-someone-else`.
 */
function isWithin(approved: string, candidate: string) {
    try {
        const base = new URL(approved);
        const target = new URL(candidate);
        if (base.origin !== target.origin) return false;
        const basePath = base.pathname.replace(/\/+$/, "");
        if (!basePath) return true;
        return target.pathname === basePath || target.pathname.startsWith(`${basePath}/`);
    } catch {
        return false;
    }
}
