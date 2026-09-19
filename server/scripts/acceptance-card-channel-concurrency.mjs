/**
 * Concurrency acceptance for channel sales, run against a live deployment.
 *
 * Three properties, all of which only fail under real parallelism:
 * 1. Simultaneous checkouts with the same `reference` produce one order, so a retrying downstream
 *    cannot charge its buyer twice.
 * 2. Simultaneous settlements of one order accrue commission exactly once.
 * 3. Simultaneous deliveries never hand the same code to two orders.
 *
 * Usage: node acceptance-card-channel-concurrency.mjs <baseUrl> <adminSessionId>
 * The session id is the `ic_session` cookie value from a signed-in admin browser.
 */

const [, , BASE, SESSION] = process.argv;
if (!BASE || !SESSION) {
    console.error("usage: node acceptance-card-channel-concurrency.mjs <baseUrl> <adminSessionId>");
    process.exit(2);
}

let passed = 0;
const failures = [];

function check(name, condition, detail) {
    if (condition) {
        passed += 1;
        console.log(`  ok   ${name}`);
    } else {
        failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

async function admin(path, { method = "GET", body } = {}) {
    const response = await fetch(`${BASE}${path}`, {
        method,
        headers: { cookie: `ic_session=${SESSION}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    try {
        return { status: response.status, data: JSON.parse(text) };
    } catch {
        return { status: response.status, data: text };
    }
}

async function channel(path, { method = "GET", body, secret } = {}) {
    const response = await fetch(`${BASE}${path}`, {
        method,
        headers: { authorization: `Bearer ${secret}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    try {
        return { status: response.status, data: JSON.parse(text) };
    } catch {
        return { status: response.status, data: text };
    }
}

const stamp = Date.now();

async function main() {
    const product = await admin("/api/admin/card-shop/products", {
        method: "POST",
        // Unit price of 1.00 keeps the commission arithmetic below easy to read.
        body: { name: `并发验收 ${stamp}`, faceValue: "10", salePrice: "1", perOrderLimit: 5, sortOrder: 9999, enabled: true },
    });
    const productId = product.data?.product?.id ?? product.data?.id;
    check("product created", Boolean(productId), JSON.stringify(product.data).slice(0, 200));

    await admin(`/api/admin/card-shop/products/${productId}/generate`, { method: "POST", body: { quantity: 30, batchName: `conc ${stamp}` } });

    const created = await admin("/api/admin/card-dist/merchants", {
        method: "POST",
        body: { name: `并发渠道 ${stamp}`, commissionMode: "rate", commissionRate: "0.2", holdDays: 0, dailySalesLimit: "0", productScope: [productId], enabled: true },
    });
    const merchantId = created.data?.merchant?.id;
    const secret = created.data?.secret;
    check("channel created", Boolean(secret));

    const products = await channel("/api/card-dist/v1/products", { secret });
    const method = products.data?.methods?.[0]?.method ?? "alipay";

    console.log("\n[parallel checkouts sharing one reference]");
    const reference = `conc-${stamp}-same`;
    const attempts = await Promise.all(
        Array.from({ length: 6 }, () =>
            channel("/api/card-dist/v1/checkouts", {
                method: "POST",
                secret,
                body: { productId, quantity: 2, email: `c${stamp}@example.com`, reference, method },
            }),
        ),
    );
    const ok = attempts.filter((item) => item.status < 300);
    const orderNos = new Set(ok.map((item) => item.data?.orderNo));
    check("every concurrent attempt answered", ok.length === 6, `answered ${ok.length}/6`);
    check("they all share one order number", orderNos.size === 1, `${orderNos.size} distinct: ${[...orderNos].join(", ")}`);
    for (const attempt of attempts.filter((item) => item.status >= 300)) {
        console.log(`       refused: ${attempt.status} ${attempt.data?.code ?? ""} ${String(attempt.data?.message ?? "").slice(0, 60)}`);
    }

    const orders = await channel("/api/card-dist/v1/orders", { secret });
    const matching = (orders.data?.items ?? []).filter((item) => item.reference === reference);
    check("only one order exists for that reference", matching.length === 1, `found ${matching.length}`);
    const orderNo = [...orderNos][0];

    console.log("\n[parallel settlements of one order]");
    const settles = await Promise.all(Array.from({ length: 5 }, () => admin("/api/admin/card-shop/settle", { method: "POST", body: { orderNo, amount: "2.00" } })));
    const settled = settles.filter((item) => item.status < 300);
    check("settlement is answered rather than erroring", settled.length > 0, `succeeded ${settled.length}/5`);

    const summary = await admin(`/api/admin/card-dist/merchants/${merchantId}/summary`);
    check("commission accrued exactly once (2.00 × 20%)", summary.data?.commissionBalance === "0.400000", `got ${summary.data?.commissionBalance}`);
    check("gross sales counted once", summary.data?.grossSales === "2.000000", `got ${summary.data?.grossSales}`);

    const ledger = await admin(`/api/admin/card-dist/merchants/${merchantId}/ledger`);
    const commissionRows = (ledger.data?.items ?? []).filter((row) => row.type === "commission");
    check("exactly one commission ledger row", commissionRows.length === 1, `got ${commissionRows.length}`);
    const sum = (ledger.data?.items ?? []).reduce((total, row) => total + Number(row.amount), 0);
    check("the ledger sums to what we owe", Math.abs(sum - Number(summary.data?.commissionBalance)) < 0.000001, `sum ${sum}`);

    const view = await channel(`/api/card-dist/v1/checkouts/${orderNo}`, { secret });
    check("the order delivered exactly the quantity ordered", view.data?.codes?.length === 2, `got ${view.data?.codes?.length}`);

    console.log("\n[parallel deliveries never share a code]");
    const many = await Promise.all(
        Array.from({ length: 8 }, (_unused, index) =>
            channel("/api/card-dist/v1/checkouts", {
                method: "POST",
                secret,
                body: { productId, quantity: 3, email: `c${stamp}@example.com`, reference: `conc-${stamp}-m${index}`, method },
            }),
        ),
    );
    const openOrders = many.filter((item) => item.status < 300).map((item) => item.data.orderNo);
    await Promise.all(openOrders.map((no) => admin("/api/admin/card-shop/settle", { method: "POST", body: { orderNo: no, amount: "3.00" } })));

    const delivered = await Promise.all(openOrders.map((no) => channel(`/api/card-dist/v1/checkouts/${no}`, { secret })));
    const codes = delivered.flatMap((item) => item.data?.codes ?? []);
    const unique = new Set(codes);
    check("no code was delivered to two orders", unique.size === codes.length, `${codes.length} codes, ${unique.size} unique`);
    console.log(`       ${openOrders.length} orders settled, ${codes.length} codes issued`);

    const finalSummary = await admin(`/api/admin/card-dist/merchants/${merchantId}/summary`);
    const expected = ((2 + codes.length) * 0.2).toFixed(6);
    check("commission still matches settled sales exactly", finalSummary.data?.commissionBalance === expected, `expected ${expected}, got ${finalSummary.data?.commissionBalance}`);

    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
        for (const failure of failures) console.log(`  - ${failure}`);
        process.exit(1);
    }
    console.log(`cleanup hints: product=${productId} channel=${merchantId}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
