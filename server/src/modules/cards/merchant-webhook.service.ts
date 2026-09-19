import { createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import { DB, type Database } from "../../db/db.module";
import { cardMerchants, cardOrders } from "../../db/schema";
import { money } from "../../common/money";
import { MerchantService } from "./merchant.service";

/** Replay window the receiver should enforce. Documented, so keep it in sync with the docs page. */
export const WEBHOOK_REPLAY_WINDOW_SECONDS = 300;
const MAX_ATTEMPTS = 6;
const REQUEST_TIMEOUT_MS = 8000;

/** How many settled orders a channel needs before its refund rate means anything. */
const REFUND_GUARD_MIN_ORDERS = 20;
/** Above this share of reversed orders the channel is stopped, to protect the merchant account. */
const REFUND_GUARD_RATE = 0.2;

export type WebhookEvent = "order.paid" | "order.reversed";

/**
 * Outbound notifications to sales channels.
 *
 * Signing follows the widely-copied Stripe scheme — `t=<unix>,v1=<hex hmac of "t.body">` — because it
 * is what integrators already know how to verify, and the timestamp is what makes a captured request
 * unusable later.
 *
 * A channel is told when one of its sales settled, so it can mark its own order fulfilled without
 * polling. The webhook is a convenience, never the authority: the codes and the money still come
 * from our API, so a channel that ignores webhooks entirely still works correctly.
 */
@Injectable()
export class MerchantWebhookService {
    private readonly logger = new Logger(MerchantWebhookService.name);

    constructor(
        @Inject(DB) private readonly db: Database,
        private readonly merchants: MerchantService,
    ) {}

    static sign(secret: string, body: string, timestampSeconds: number) {
        const signature = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
        return { header: `t=${timestampSeconds},v1=${signature}`, signature };
    }

    /** Mirrors what a receiver should implement; also used by the tests. */
    static verify(secret: string, body: string, header: string, nowSeconds = Math.floor(Date.now() / 1000)) {
        const parts = Object.fromEntries(
            header
                .split(",")
                .map((part) => part.trim().split("="))
                .filter((pair) => pair.length === 2) as Array<[string, string]>,
        );
        const timestamp = Number(parts.t);
        if (!Number.isFinite(timestamp)) return false;
        if (Math.abs(nowSeconds - timestamp) > WEBHOOK_REPLAY_WINDOW_SECONDS) return false;
        const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
        const actual = parts.v1 ?? "";
        if (actual.length !== expected.length) return false;
        return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
    }

    /**
     * Tells a channel one of its sales settled. Fire-and-forget from the settlement path: a slow or
     * dead endpoint must never delay a buyer's delivery or roll back a payment.
     */
    async notifyOrderPaid(orderId: string) {
        const [row] = await this.db
            .select({ order: cardOrders, merchant: cardMerchants })
            .from(cardOrders)
            .innerJoin(cardMerchants, eq(cardMerchants.id, cardOrders.merchantId))
            .where(eq(cardOrders.id, orderId))
            .limit(1);
        if (!row?.merchant.webhookUrl) return false;
        return this.deliver(row.merchant, "order.paid", {
            orderNo: row.order.orderNo,
            reference: row.order.merchantReference,
            productName: row.order.productName,
            quantity: row.order.quantity,
            amount: row.order.amount,
            commission: row.order.commissionAmount,
            paidAt: row.order.paidAt?.toISOString() ?? "",
        });
    }

    async notifyOrderReversed(orderId: string) {
        const [row] = await this.db
            .select({ order: cardOrders, merchant: cardMerchants })
            .from(cardOrders)
            .innerJoin(cardMerchants, eq(cardMerchants.id, cardOrders.merchantId))
            .where(eq(cardOrders.id, orderId))
            .limit(1);
        if (!row?.merchant.webhookUrl) return false;
        return this.deliver(row.merchant, "order.reversed", {
            orderNo: row.order.orderNo,
            reference: row.order.merchantReference,
            amount: row.order.amount,
            commission: row.order.commissionAmount,
        });
    }

    /**
     * Stops channels whose refunds are running hot.
     *
     * A concentrated pile of refunds and chargebacks on one merchant account is what gets funds held,
     * and by the time the provider notices it is our account that is frozen, not the channel's. So
     * the guard runs on our side and errs towards cutting a channel off early.
     */
    async enforceRefundGuard() {
        const rows = await this.db
            .select({
                merchantId: cardOrders.merchantId,
                paid: sql<number>`count(*) filter (where ${cardOrders.status} = 'paid')::int`,
                reversed: sql<number>`count(*) filter (where ${cardOrders.commissionState} = 'reversed')::int`,
            })
            .from(cardOrders)
            .where(and(isNotNull(cardOrders.merchantId), gt(cardOrders.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))))
            .groupBy(cardOrders.merchantId);

        let suspended = 0;
        for (const row of rows) {
            if (!row.merchantId || row.paid < REFUND_GUARD_MIN_ORDERS) continue;
            const rate = row.reversed / row.paid;
            if (rate < REFUND_GUARD_RATE) continue;
            const result = await this.merchants.suspend(
                row.merchantId,
                `近 30 天退款率 ${(rate * 100).toFixed(1)}%（${row.reversed}/${row.paid}）超过阈值，为保护收款账户已自动停用`,
            );
            if (result.changed) suspended += 1;
        }
        if (suspended) this.logger.warn(`Suspended ${suspended} channel(s) on refund rate`);
        return { checked: rows.length, suspended };
    }

    /** Retries with exponential backoff. Returns true once the receiver answers 2xx. */
    private async deliver(row: typeof cardMerchants.$inferSelect, event: WebhookEvent, data: Record<string, unknown>) {
        const secret = this.merchants.webhookSecretFor(row);
        if (!secret) {
            this.logger.warn(`Channel ${row.id} has a webhook URL but no secret; skipping`);
            return false;
        }
        const body = JSON.stringify({ event, sentAt: new Date().toISOString(), data });

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
            const timestamp = Math.floor(Date.now() / 1000);
            const { header } = MerchantWebhookService.sign(secret, body, timestamp);
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
                try {
                    const response = await fetch(row.webhookUrl, {
                        method: "POST",
                        headers: { "content-type": "application/json", "x-jt-signature": header, "x-jt-event": event },
                        body,
                        signal: controller.signal,
                    });
                    if (response.ok) return true;
                    this.logger.warn(`Webhook to ${row.id} answered ${response.status} (attempt ${attempt})`);
                } finally {
                    clearTimeout(timer);
                }
            } catch (error) {
                this.logger.warn(`Webhook to ${row.id} failed (attempt ${attempt}): ${error instanceof Error ? error.message : "unknown"}`);
            }
            if (attempt < MAX_ATTEMPTS) await delay(2 ** attempt * 250);
        }
        return false;
    }
}

function delay(ms: number) {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, ms).unref?.();
    });
}

/** Kept exported for the reconciliation job, which reports rather than acts. */
export function isCommissionOverpaid(balance: string, ledgerSum: string) {
    return !money(balance).eq(money(ledgerSum));
}
