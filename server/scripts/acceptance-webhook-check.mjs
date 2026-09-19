/**
 * End-to-end check of the `order.paid` webhook against a live deployment.
 *
 * Points a channel at the stand-in receiver, opens a checkout, settles it, then confirms the
 * receiver saw a correctly signed delivery. Pair it with `acceptance-webhook-receiver.mjs`, which
 * verifies the signature exactly the way the integration docs tell a channel to.
 *
 * Usage: node acceptance-webhook-check.mjs <baseUrl> <adminSessionId> <receiverUrl>
 * The session id is the `ic_session` cookie value from a signed-in admin browser.
 */

const [, , BASE, SESSION, RECEIVER] = process.argv;
if (!BASE || !SESSION || !RECEIVER) {
    console.error("usage: node acceptance-webhook-check.mjs <baseUrl> <adminSessionId> <receiverUrl>");
    process.exit(2);
}

const WEBHOOK_SECRET = "whsec_acceptance_test";
const stamp = Date.now();

async function api(path, { method = "GET", body, secret } = {}) {
    const response = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            ...(body ? { "content-type": "application/json" } : {}),
            ...(secret ? { authorization: `Bearer ${secret}` } : { cookie: `ic_session=${SESSION}` }),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    try {
        return { status: response.status, data: JSON.parse(text) };
    } catch {
        return { status: response.status, data: text };
    }
}

const product = await api("/api/admin/card-shop/products", {
    method: "POST",
    body: { name: `渠道验收 webhook ${stamp}`, faceValue: "10", salePrice: "1", perOrderLimit: 5, sortOrder: 9999, enabled: true },
});
const productId = product.data?.product?.id ?? product.data?.id;
await api(`/api/admin/card-shop/products/${productId}/generate`, { method: "POST", body: { quantity: 3, batchName: `webhook ${stamp}` } });

const channel = await api("/api/admin/card-dist/merchants", {
    method: "POST",
    body: {
        name: `验收渠道 webhook ${stamp}`,
        commissionMode: "rate",
        commissionRate: "0.1",
        holdDays: 0,
        dailySalesLimit: "0",
        productScope: [productId],
        webhookUrl: RECEIVER,
        webhookSecret: WEBHOOK_SECRET,
        enabled: true,
    },
});
const secret = channel.data?.secret;
console.log(`channel ${channel.data?.merchant?.name} armed at ${RECEIVER}`);

const methods = await api("/api/card-dist/v1/products", { secret });
const method = methods.data?.methods?.[0]?.method ?? "alipay";

const checkout = await api("/api/card-dist/v1/checkouts", {
    method: "POST",
    secret,
    body: { productId, quantity: 1, email: `wh${stamp}@example.com`, reference: `wh-${stamp}`, method },
});
console.log(`checkout ${checkout.data?.orderNo} opened for ${checkout.data?.amount}`);

const settled = await api("/api/admin/card-shop/settle", { method: "POST", body: { orderNo: checkout.data?.orderNo, amount: "1.00" } });
console.log(`settled: ${settled.status} ${JSON.stringify(settled.data).slice(0, 160)}`);

console.log("\nThe webhook is delivered asynchronously; read the receiver's log to confirm it arrived");
console.log(`expected: event order.paid, reference wh-${stamp}, commission 0.100000, signatureValid true, tamperedRejected true`);
console.log(`cleanup hints: product=${productId} channel=${channel.data?.merchant?.id}`);
