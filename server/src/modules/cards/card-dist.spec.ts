import { describe, expect, it } from "vitest";
import { hashToken } from "./card-shop.service";
import { bearerSecret, clientIp, userAgentOf } from "./merchant.guard";
import { MerchantWebhookService, WEBHOOK_REPLAY_WINDOW_SECONDS } from "./merchant-webhook.service";
import { commissionFor, commissionPayableAt, fitsDailyLimit, resolveReturnUrl } from "./merchant.rules";

describe("bearerSecret", () => {
    it("reads the standard Bearer header case-insensitively", () => {
        expect(bearerSecret({ authorization: "Bearer sk_cd_abc" })).toBe("sk_cd_abc");
        expect(bearerSecret({ authorization: "bearer sk_cd_abc" })).toBe("sk_cd_abc");
    });

    it("also accepts the bare x-api-key form some clients send", () => {
        expect(bearerSecret({ "x-api-key": "sk_cd_abc" })).toBe("sk_cd_abc");
    });

    it("returns an empty string when nothing was provided", () => {
        expect(bearerSecret({})).toBe("");
    });
});

describe("clientIp", () => {
    it("takes the first hop of x-forwarded-for, which nginx sets to the real client", () => {
        expect(clientIp({ headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" }, ip: "10.0.0.1" })).toBe("203.0.113.10");
    });

    it("falls back to the socket address without a proxy", () => {
        expect(clientIp({ headers: {}, ip: "10.0.0.1" })).toBe("10.0.0.1");
        expect(clientIp({ headers: {} })).toBe("");
    });
});

describe("userAgentOf", () => {
    it("reads the header and tolerates its absence", () => {
        expect(userAgentOf({ headers: { "user-agent": "iPhone" } })).toBe("iPhone");
        expect(userAgentOf({ headers: {} })).toBe("");
    });
});

describe("commissionFor", () => {
    it("takes a share of the settled amount in rate mode", () => {
        expect(commissionFor({ commissionMode: "rate", commissionRate: "0.15" }, { amount: "100.000000", quantity: 2 })).toBe("15.000000");
    });

    it("pays per card in fixed mode", () => {
        expect(commissionFor({ commissionMode: "fixed", commissionRate: "1.50" }, { amount: "100.000000", quantity: 4 })).toBe("6.000000");
    });

    it("never promises more than the buyer actually paid", () => {
        // A misconfigured fixed rate must not make us owe more than we collected.
        expect(commissionFor({ commissionMode: "fixed", commissionRate: "80" }, { amount: "100.000000", quantity: 5 })).toBe("100.000000");
        expect(commissionFor({ commissionMode: "rate", commissionRate: "1" }, { amount: "9.900000", quantity: 1 })).toBe("9.900000");
    });

    it("is zero when no commission was agreed", () => {
        expect(commissionFor({ commissionMode: "rate", commissionRate: "0" }, { amount: "100.000000", quantity: 1 })).toBe("0.000000");
    });

    it("keeps six-decimal precision rather than rounding to cents", () => {
        expect(commissionFor({ commissionMode: "rate", commissionRate: "0.155" }, { amount: "9.900000", quantity: 1 })).toBe("1.534500");
    });
});

describe("fitsDailyLimit", () => {
    it("allows anything when no cap is set", () => {
        expect(fitsDailyLimit({ dailySalesLimit: "0.000000", soldToday: "99999.000000", amount: "100.000000" })).toBe(true);
    });

    it("allows a sale that exactly fills the remaining room", () => {
        expect(fitsDailyLimit({ dailySalesLimit: "1000.000000", soldToday: "900.000000", amount: "100.000000" })).toBe(true);
    });

    it("refuses the sale that would cross the cap", () => {
        expect(fitsDailyLimit({ dailySalesLimit: "1000.000000", soldToday: "900.000000", amount: "100.000001" })).toBe(false);
        expect(fitsDailyLimit({ dailySalesLimit: "1000.000000", soldToday: "1000.000000", amount: "0.010000" })).toBe(false);
    });

    it("stays refused once the cap has somehow been exceeded", () => {
        expect(fitsDailyLimit({ dailySalesLimit: "1000.000000", soldToday: "1200.000000", amount: "1.000000" })).toBe(false);
    });

    it("refuses rather than opening up when the cap is unreadable", () => {
        // Failing closed matters here: the cap is what protects the payment account.
        expect(fitsDailyLimit({ dailySalesLimit: "not-a-number", soldToday: "0.000000", amount: "1.000000" })).toBe(false);
    });
});

describe("commissionPayableAt", () => {
    it("adds the hold window to the settlement time", () => {
        const paidAt = new Date("2026-01-01T00:00:00.000Z");
        expect(commissionPayableAt(paidAt, 7).toISOString()).toBe("2026-01-08T00:00:00.000Z");
    });

    it("makes commission payable immediately when there is no hold", () => {
        const paidAt = new Date("2026-01-01T00:00:00.000Z");
        expect(commissionPayableAt(paidAt, 0).getTime()).toBe(paidAt.getTime());
    });

    it("treats a negative hold as no hold rather than back-dating it", () => {
        const paidAt = new Date("2026-01-01T00:00:00.000Z");
        expect(commissionPayableAt(paidAt, -5).getTime()).toBe(paidAt.getTime());
    });
});

describe("resolveReturnUrl", () => {
    const merchant = { returnUrls: ["https://shop.example.com/pay", "https://alt.example.net/done"] };

    it("falls back to the first approved entry when the caller asks for nothing", () => {
        expect(resolveReturnUrl(merchant)).toBe("https://shop.example.com/pay");
    });

    it("accepts an approved URL and paths underneath it", () => {
        expect(resolveReturnUrl(merchant, "https://shop.example.com/pay")).toBe("https://shop.example.com/pay");
        expect(resolveReturnUrl(merchant, "https://shop.example.com/pay/thanks?id=7")).toBe("https://shop.example.com/pay/thanks?id=7");
        expect(resolveReturnUrl(merchant, "https://alt.example.net/done")).toBe("https://alt.example.net/done");
    });

    it("refuses anything outside the allowlist, which is what stops an open redirect", () => {
        expect(() => resolveReturnUrl(merchant, "https://evil.example.com/pay")).toThrow();
        // Same host as an approved entry but a different scheme or port is a different origin.
        expect(() => resolveReturnUrl(merchant, "http://shop.example.com/pay")).toThrow();
        expect(() => resolveReturnUrl(merchant, "https://shop.example.com:8443/pay")).toThrow();
        // A prefix trick: `shop.example.com.evil.test` must not pass as `shop.example.com`.
        expect(() => resolveReturnUrl(merchant, "https://shop.example.com.evil.test/pay")).toThrow();
        // A sibling path outside the approved prefix.
        expect(() => resolveReturnUrl(merchant, "https://shop.example.com/admin")).toThrow();
        expect(() => resolveReturnUrl(merchant, "not-a-url")).toThrow();
    });

    it("returns nothing when the channel registered no URL, so we keep the buyer on our own page", () => {
        expect(resolveReturnUrl({ returnUrls: [] })).toBe("");
    });
});

describe("hashToken", () => {
    it("is deterministic and never returns the input", () => {
        const hash = hashToken("secret-token");
        expect(hash).toBe(hashToken("secret-token"));
        expect(hash).not.toContain("secret-token");
        expect(hash).toHaveLength(64);
    });

    it("separates two different tokens", () => {
        expect(hashToken("a")).not.toBe(hashToken("b"));
    });
});

describe("webhook signing", () => {
    const secret = "whsec_test";
    const body = JSON.stringify({ event: "order.paid", data: { orderNo: "C1" } });

    it("verifies a signature it just produced", () => {
        const now = 1_700_000_000;
        const { header } = MerchantWebhookService.sign(secret, body, now);
        expect(MerchantWebhookService.verify(secret, body, header, now)).toBe(true);
    });

    it("rejects a signature made with a different secret", () => {
        const now = 1_700_000_000;
        const { header } = MerchantWebhookService.sign("other", body, now);
        expect(MerchantWebhookService.verify(secret, body, header, now)).toBe(false);
    });

    it("rejects a tampered body", () => {
        const now = 1_700_000_000;
        const { header } = MerchantWebhookService.sign(secret, body, now);
        expect(MerchantWebhookService.verify(secret, `${body} `, header, now)).toBe(false);
    });

    it("rejects a captured request replayed outside the window", () => {
        const signedAt = 1_700_000_000;
        const { header } = MerchantWebhookService.sign(secret, body, signedAt);
        expect(MerchantWebhookService.verify(secret, body, header, signedAt + WEBHOOK_REPLAY_WINDOW_SECONDS - 1)).toBe(true);
        expect(MerchantWebhookService.verify(secret, body, header, signedAt + WEBHOOK_REPLAY_WINDOW_SECONDS + 1)).toBe(false);
    });

    it("rejects a malformed or empty header rather than throwing", () => {
        expect(MerchantWebhookService.verify(secret, body, "", 1_700_000_000)).toBe(false);
        expect(MerchantWebhookService.verify(secret, body, "garbage", 1_700_000_000)).toBe(false);
        expect(MerchantWebhookService.verify(secret, body, "t=abc,v1=def", 1_700_000_000)).toBe(false);
    });
});
