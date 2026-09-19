/**
 * Regression check for ordinary retail redemption, which the distribution work touched: the main
 * site's redeem flow now rejects any card a distributor has drawn, and this confirms it still
 * accepts a card that nobody drew.
 *
 * Uses a one-cent face value and reverses the credit afterwards, so a live wallet is left exactly as
 * it was found.
 *
 * Usage: node acceptance-retail-redeem.mjs <baseUrl> <adminSessionId>
 * The session id is the `ic_session` cookie value from a signed-in admin browser.
 */

const [, , BASE, SESSION] = process.argv;
if (!BASE || !SESSION) {
    console.error("usage: node acceptance-retail-redeem.mjs <baseUrl> <adminSessionId>");
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

async function api(path, { method = "GET", body, headers = {} } = {}) {
    const response = await fetch(`${BASE}${path}`, {
        method,
        headers: { cookie: `ic_session=${SESSION}`, ...(body ? { "content-type": "application/json" } : {}), ...headers },
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
    const me = await api("/api/auth/me");
    if (me.data?.role !== "admin") throw new Error(`session is not an admin: ${JSON.stringify(me.data)}`);

    const before = await api("/api/wallet");
    const balanceBefore = before.data?.balance;
    console.log(`admin ${me.data.username}, wallet ${balanceBefore}`);

    const product = await api("/api/admin/card-shop/products", {
        method: "POST",
        body: { name: `兑换回归 ${stamp}`, faceValue: "0.01", salePrice: "0.01", perOrderLimit: 1, sortOrder: 9999, enabled: false },
    });
    const productId = product.data?.product?.id ?? product.data?.id;
    check("product created", Boolean(productId), JSON.stringify(product.data).slice(0, 160));

    const generated = await api(`/api/admin/card-shop/products/${productId}/generate`, { method: "POST", body: { quantity: 1, batchName: `redeem regression ${stamp}` } });
    check("one card generated", generated.status < 300, JSON.stringify(generated.data).slice(0, 200));

    // Read the code back through the admin card-batch view rather than the shop, since the product is
    // deliberately left off sale.
    const batches = await api(`/api/admin/cards?page=1&pageSize=5&keyword=${encodeURIComponent(`redeem regression ${stamp}`)}`);
    const batchId = batches.data?.items?.[0]?.id;
    check("the batch is listed for an admin", Boolean(batchId), JSON.stringify(batches.data).slice(0, 200));
    const items = await api(`/api/admin/cards/${batchId}/items?page=1&pageSize=5`);
    const code = items.data?.items?.[0]?.code;
    check("the generated code is readable by an admin", Boolean(code), JSON.stringify(items.data).slice(0, 200));
    if (!code) throw new Error("cannot continue without a code");

    const redeemed = await api("/api/wallet/redeem", { method: "POST", body: { code }, headers: { "idempotency-key": `redeem-${stamp}` } });
    check("an undrawn card still redeems normally", redeemed.status < 300, `${redeemed.status} ${JSON.stringify(redeemed.data).slice(0, 200)}`);

    const after = await api("/api/wallet");
    const delta = Number(after.data?.balance) - Number(balanceBefore);
    check("the wallet was credited by the face value", Math.abs(delta - 0.01) < 0.000001, `delta ${delta}`);

    const twice = await api("/api/wallet/redeem", { method: "POST", body: { code }, headers: { "idempotency-key": `redeem-${stamp}-2` } });
    check("redeeming the same card twice is still refused", twice.status >= 400, `status ${twice.status}`);

    // Put the wallet back exactly where it was.
    if (Math.abs(delta) > 0) {
        const reversal = await api(`/api/admin/users/${me.data.id}/balance`, {
            method: "POST",
            body: { amount: `-${delta.toFixed(2)}`, note: `卡密兑换回归测试冲正 ${stamp}` },
        });
        const restored = await api("/api/wallet");
        check("the test credit was reversed", Number(restored.data?.balance) === Number(balanceBefore), `${restored.data?.balance} vs ${balanceBefore} (${reversal.status})`);
    }

    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
        for (const failure of failures) console.log(`  - ${failure}`);
        process.exit(1);
    }
    console.log(`cleanup hint: product=${productId}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
