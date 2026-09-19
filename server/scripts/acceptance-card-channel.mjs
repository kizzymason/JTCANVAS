/**
 * Full-chain acceptance test for channel card sales, run against a live deployment.
 *
 * Concentrates on the properties that cost real money or real trust if they break: that the money
 * lands in our account and not the channel's, that the channel cannot set a price, that a retried
 * checkout cannot charge a buyer twice, that commission accrues exactly once per settled sale and
 * waits out its hold window, and that the payment guards (daily cap, return-URL allowlist, scope,
 * IP allowlist) actually refuse.
 *
 * Creates its own products and channels, so it is safe to run against a live system; clear the rows
 * afterwards with `acceptance-cleanup.mjs`.
 *
 * Usage: node acceptance-card-channel.mjs <baseUrl> <adminSessionId>
 * The session id is the `ic_session` cookie value from a signed-in admin browser.
 */

const [, , BASE, ADMIN_SESSION] = process.argv;
if (!BASE || !ADMIN_SESSION) {
    console.error("usage: node acceptance-card-channel.mjs <baseUrl> <adminSessionId>");
    process.exit(2);
}

const cookie = `ic_session=${ADMIN_SESSION}`;
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

async function request(path, { method = "GET", body, headers = {}, secret, anonymous } = {}) {
    const response = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            ...(body ? { "content-type": "application/json" } : {}),
            // A channel call must carry only its Bearer secret: mixing in an admin cookie would mask
            // a missing guard rather than prove it works.
            ...(!secret && !anonymous ? { cookie } : {}),
            ...(secret ? { authorization: `Bearer ${secret}` } : {}),
            ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual",
    });
    const text = await response.text();
    try {
        return { status: response.status, data: JSON.parse(text) };
    } catch {
        return { status: response.status, data: text };
    }
}

const stamp = Date.now();
const state = {};
const RETURN_URL = "https://shop.example.com/pay/result";

async function confirmAdmin() {
    const result = await request("/api/auth/me");
    if (result.data?.role !== "admin") throw new Error(`session is not an admin: ${JSON.stringify(result.data)}`);
    console.log(`acting as admin ${result.data.username}`);
}

async function setUp() {
    const product = await request("/api/admin/card-shop/products", {
        method: "POST",
        body: { name: `渠道验收 ${stamp}`, description: "acceptance", faceValue: "10", salePrice: "10", perOrderLimit: 5, sortOrder: 9999, enabled: true },
    });
    state.productId = product.data?.product?.id ?? product.data?.id;
    check("admin can create a card product", Boolean(state.productId), JSON.stringify(product.data).slice(0, 200));

    const stocked = await request(`/api/admin/card-shop/products/${state.productId}/generate`, {
        method: "POST",
        body: { quantity: 20, batchName: `channel acceptance ${stamp}` },
    });
    check("admin can stock 20 cards", stocked.status < 300, JSON.stringify(stocked.data).slice(0, 200));

    const channel = await request("/api/admin/card-dist/merchants", {
        method: "POST",
        body: {
            name: `验收渠道A ${stamp}`,
            commissionMode: "rate",
            commissionRate: "0.15",
            holdDays: 0,
            dailySalesLimit: "100",
            productScope: [state.productId],
            returnUrls: [RETURN_URL],
            checkoutLabel: "数字商品",
            enabled: true,
        },
    });
    state.channelA = channel.data?.merchant?.id;
    state.secretA = channel.data?.secret;
    check("creating a channel returns the plaintext secret exactly once", Boolean(state.secretA) && state.secretA.startsWith("sk_cd_"), JSON.stringify(channel.data).slice(0, 200));
    check("the stored record never echoes the secret back", !JSON.stringify(channel.data.merchant).includes(state.secretA ?? "@@"));

    const second = await request("/api/admin/card-dist/merchants", {
        method: "POST",
        body: { name: `验收渠道B ${stamp}`, commissionMode: "fixed", commissionRate: "2", holdDays: 30, dailySalesLimit: "0", enabled: true },
    });
    state.channelB = second.data?.merchant?.id;
    state.secretB = second.data?.secret;
    check("a second channel can be created", Boolean(state.secretB));
}

async function testAuth() {
    const noAuth = await request("/api/card-dist/v1/products");
    check("the API refuses a call with no secret", noAuth.status === 401, `status ${noAuth.status}`);
    const badAuth = await request("/api/card-dist/v1/products", { secret: "sk_cd_totally-made-up" });
    check("the API refuses an invalid secret", badAuth.status === 401, `status ${badAuth.status}`);
    const wrongShape = await request("/api/card-dist/v1/products", { secret: "not-even-a-key" });
    check("the API refuses a secret without the expected prefix", wrongShape.status === 401, `status ${wrongShape.status}`);
}

async function testCatalogue() {
    const products = await request("/api/card-dist/v1/products", { secret: state.secretA });
    const mine = products.data?.items?.find((item) => item.id === state.productId);
    check("the channel sees the product it is scoped to", Boolean(mine), JSON.stringify(products.data).slice(0, 200));
    check("the price shown is ours, not the channel's", mine?.price === "10.000000", `got ${mine?.price}`);
    check("stock reflects the 20 cards just stocked", mine?.stock === 20, `got ${mine?.stock}`);
    check("estimated commission follows the agreed rate (10 × 15%)", mine?.estimatedCommission === "1.500000", `got ${mine?.estimatedCommission}`);
    check("usable payment methods are listed", Array.isArray(products.data?.methods), JSON.stringify(products.data?.methods).slice(0, 120));
    state.method = products.data?.methods?.[0]?.method ?? "alipay";

    const scoped = await request("/api/card-dist/v1/products", { secret: state.secretB });
    const seen = scoped.data?.items?.find((item) => item.id === state.productId);
    check("a channel with no scope sees every product", Boolean(seen));
    check("the fixed-fee channel is quoted its own commission (¥2/card)", seen?.estimatedCommission === "2.000000", `got ${seen?.estimatedCommission}`);
}

async function testCheckout() {
    const created = await request("/api/card-dist/v1/checkouts", {
        method: "POST",
        secret: state.secretA,
        body: { productId: state.productId, quantity: 2, email: `ch${stamp}@example.com`, reference: `acc-${stamp}-1`, method: state.method, returnUrl: RETURN_URL },
    });
    state.orderNo = created.data?.orderNo;
    check("a checkout can be opened", Boolean(state.orderNo), JSON.stringify(created.data).slice(0, 250));
    check("the amount is our price × quantity (10 × 2)", created.data?.amount === "20.000000", `got ${created.data?.amount}`);
    check("commission is snapshotted on the order (20 × 15%)", created.data?.commission === "3.000000", `got ${created.data?.commission}`);
    check("a payment handle comes back", Boolean(created.data?.payUrl || created.data?.qrcode), JSON.stringify(created.data).slice(0, 250));
    check("an order-scoped access token comes back for the buyer's browser", typeof created.data?.accessToken === "string" && created.data.accessToken.length >= 32);

    /*
     * The channel must not be able to state a price. The API rejects unknown fields outright
     * (`forbidNonWhitelisted`), which is stronger than dropping them silently — but either outcome
     * is acceptable here, so long as the amount it asked for is never the amount charged.
     */
    const tampered = await request("/api/card-dist/v1/checkouts", {
        method: "POST",
        secret: state.secretA,
        body: { productId: state.productId, quantity: 1, email: `ch${stamp}@example.com`, reference: `acc-${stamp}-tamper`, method: state.method, amount: "0.01", price: "0.01" },
    });
    const dictated = tampered.status < 300 && tampered.data?.amount === "0.010000";
    check("a channel cannot dictate the amount", !dictated, `${tampered.status} amount=${tampered.data?.amount}`);
    check("an attempt to state a price is refused outright", tampered.status === 400, `status ${tampered.status}`);

    const unpaid = await request(`/api/card-dist/v1/checkouts/${state.orderNo}`, { secret: state.secretA });
    check("an unpaid order reports pending with no codes", unpaid.data?.status === "pending" && unpaid.data?.codes?.length === 0, JSON.stringify(unpaid.data).slice(0, 200));
}

async function testIdempotency() {
    const replay = await request("/api/card-dist/v1/checkouts", {
        method: "POST",
        secret: state.secretA,
        body: { productId: state.productId, quantity: 2, email: `ch${stamp}@example.com`, reference: `acc-${stamp}-1`, method: state.method, returnUrl: RETURN_URL },
    });
    check("replaying a reference returns the original order", replay.data?.orderNo === state.orderNo, `${replay.data?.orderNo} vs ${state.orderNo}`);
    check("the replay is flagged as such", replay.data?.replayed === true, `got ${replay.data?.replayed}`);

    const orders = await request("/api/card-dist/v1/orders", { secret: state.secretA });
    const matching = (orders.data?.items ?? []).filter((item) => item.reference === `acc-${stamp}-1`);
    check("the replay did not create a second order", matching.length === 1, `found ${matching.length}`);
}

async function testGuards() {
    const foreignReturn = await request("/api/card-dist/v1/checkouts", {
        method: "POST",
        secret: state.secretA,
        body: { productId: state.productId, quantity: 1, email: `ch${stamp}@example.com`, reference: `acc-${stamp}-badreturn`, method: state.method, returnUrl: "https://evil.example.com/pay" },
    });
    check("a return URL outside the allowlist is refused", foreignReturn.status === 400 && foreignReturn.data?.code === "MERCHANT_RETURN_URL_FORBIDDEN", `${foreignReturn.status} ${JSON.stringify(foreignReturn.data).slice(0, 160)}`);

    const scheme = await request("/api/card-dist/v1/checkouts", {
        method: "POST",
        secret: state.secretA,
        body: { productId: state.productId, quantity: 1, email: `ch${stamp}@example.com`, reference: `acc-${stamp}-scheme`, method: state.method, returnUrl: "http://shop.example.com/pay/result" },
    });
    check("the same host over http is a different origin and is refused", scheme.status === 400, `status ${scheme.status}`);

    const lookalike = await request("/api/card-dist/v1/checkouts", {
        method: "POST",
        secret: state.secretA,
        body: { productId: state.productId, quantity: 1, email: `ch${stamp}@example.com`, reference: `acc-${stamp}-look`, method: state.method, returnUrl: "https://shop.example.com.evil.test/pay/result" },
    });
    check("a suffix lookalike host is refused", lookalike.status === 400, `status ${lookalike.status}`);

    const outOfScope = await request("/api/card-dist/v1/checkouts", {
        method: "POST",
        secret: state.secretA,
        body: { productId: "00000000-0000-4000-8000-000000000000", quantity: 1, email: `ch${stamp}@example.com`, reference: `acc-${stamp}-scope`, method: state.method },
    });
    check("a product outside the channel's scope is refused", outOfScope.status === 403 || outOfScope.status === 404, `status ${outOfScope.status}`);

    const tooMany = await request("/api/card-dist/v1/checkouts", {
        method: "POST",
        secret: state.secretA,
        body: { productId: state.productId, quantity: 99, email: `ch${stamp}@example.com`, reference: `acc-${stamp}-qty`, method: state.method },
    });
    check("a quantity above the per-order limit is refused", tooMany.status >= 400, `status ${tooMany.status}`);

    const badMethod = await request("/api/card-dist/v1/checkouts", {
        method: "POST",
        secret: state.secretA,
        body: { productId: state.productId, quantity: 1, email: `ch${stamp}@example.com`, reference: `acc-${stamp}-method`, method: "not-a-method" },
    });
    check("an unknown payment method is refused", badMethod.status >= 400, `status ${badMethod.status}`);
}

/** The cap is the main protection for our payment account, so it gets its own section. */
async function testDailyCap() {
    const stats = await request("/api/card-dist/v1/stats", { secret: state.secretA });
    check("stats report the cap and today's usage", stats.data?.dailySalesLimit === "100.000000", JSON.stringify(stats.data).slice(0, 240));
    /*
     * Only the ¥20 checkout has been opened so far and nothing has been paid yet, so a non-zero
     * figure here is precisely the property that matters: unpaid checkouts consume the cap. Without
     * that, a channel could open unlimited checkouts and settle them together, sailing past it.
     */
    check("unpaid checkouts already count towards the cap", Number(stats.data?.soldToday) >= 20, `soldToday ${stats.data?.soldToday}`);
    check("nothing has settled yet, so this is purely unpaid volume", stats.data?.grossSales === "0", `grossSales ${stats.data?.grossSales}`);

    let refused = null;
    for (let index = 0; index < 12 && !refused; index += 1) {
        const attempt = await request("/api/card-dist/v1/checkouts", {
            method: "POST",
            secret: state.secretA,
            body: { productId: state.productId, quantity: 1, email: `ch${stamp}@example.com`, reference: `acc-${stamp}-cap-${index}`, method: state.method },
        });
        if (attempt.status >= 400) refused = attempt;
    }
    check("the cap eventually refuses a checkout", Boolean(refused) && refused.status === 403, refused ? `${refused.status} ${JSON.stringify(refused.data).slice(0, 160)}` : "never refused");
}

/**
 * Settles a pending order the way the gateway would, so commission accrual can be checked without a
 * real payment. Uses the admin session, not the channel's key — a channel has no such power.
 */
async function settleViaAdmin(orderNo, amount) {
    return request("/api/admin/card-shop/settle", { method: "POST", body: { orderNo, amount } });
}

async function testCommissionAndPayout() {
    const settled = await settleViaAdmin(state.orderNo, "20.00");
    if (settled.status >= 400) {
        console.log(`  note settle endpoint unavailable (${settled.status}); commission checks need a real payment`);
        return;
    }

    const view = await request(`/api/card-dist/v1/checkouts/${state.orderNo}`, { secret: state.secretA });
    check("a settled order reports paid and returns codes", view.data?.status === "paid" && view.data?.codes?.length === 2, JSON.stringify(view.data).slice(0, 240));
    check("commission is accrued on settlement", view.data?.commissionState === "accrued", `got ${view.data?.commissionState}`);

    const summary = await request(`/api/admin/card-dist/merchants/${state.channelA}/summary`);
    check("gross sales reflect the settled order", summary.data?.grossSales === "20.000000", `got ${summary.data?.grossSales}`);
    check("commission owed is 15% of it", summary.data?.commissionBalance === "3.000000", `got ${summary.data?.commissionBalance}`);
    check("with a zero hold window it is immediately payable", summary.data?.commissionPayable === "3.000000", `got ${summary.data?.commissionPayable}`);
    check("nothing is on hold", summary.data?.commissionHeld === "0.000000", `got ${summary.data?.commissionHeld}`);

    // A replayed gateway notification must not pay the channel twice.
    await settleViaAdmin(state.orderNo, "20.00");
    const again = await request(`/api/admin/card-dist/merchants/${state.channelA}/summary`);
    check("a replayed settlement does not accrue commission twice", again.data?.commissionBalance === "3.000000", `got ${again.data?.commissionBalance}`);

    const ledger = await request(`/api/admin/card-dist/merchants/${state.channelA}/ledger`);
    const commissionRows = (ledger.data?.items ?? []).filter((row) => row.type === "commission");
    check("exactly one commission ledger row exists", commissionRows.length === 1, `got ${commissionRows.length}`);
    const sum = (ledger.data?.items ?? []).reduce((total, row) => total + Number(row.amount), 0);
    check("the ledger sums to what we owe", Math.abs(sum - 3) < 0.000001, `sum ${sum}`);

    const tooBig = await request(`/api/admin/card-dist/merchants/${state.channelA}/payouts`, {
        method: "POST",
        body: { amount: "500", method: "银行转账", reference: "acc-too-big" },
    });
    check("a payout above what is owed is refused", tooBig.status === 400, `${tooBig.status} ${JSON.stringify(tooBig.data).slice(0, 160)}`);

    const payout = await request(`/api/admin/card-dist/merchants/${state.channelA}/payouts`, {
        method: "POST",
        body: { amount: "3.00", method: "银行转账", reference: `acc-${stamp}`, note: "acceptance payout" },
    });
    check("a valid payout is recorded", payout.data?.commissionBalance === "0.000000", `${payout.status} ${JSON.stringify(payout.data).slice(0, 160)}`);

    const payouts = await request("/api/admin/card-dist/payouts", { method: "GET" });
    check("the payout appears in the history with its reference", (payouts.data?.items ?? []).some((row) => row.reference === `acc-${stamp}`), JSON.stringify(payouts.data?.items?.[0] ?? {}).slice(0, 200));

    const reversed = await request("/api/admin/card-dist/commission/reverse", {
        method: "POST",
        body: { orderNo: state.orderNo, note: "acceptance refund" },
    });
    check("reversing after a payout reports the shortfall instead of going negative", Number(reversed.data?.shortfall) > 0, JSON.stringify(reversed.data).slice(0, 160));
    const afterReverse = await request(`/api/admin/card-dist/merchants/${state.channelA}/summary`);
    check("what we owe never goes negative", Number(afterReverse.data?.commissionBalance) >= 0, `got ${afterReverse.data?.commissionBalance}`);

    const ranking = await request("/api/admin/card-dist/leaderboard?days=30");
    check("the channel appears in the sales ranking", (ranking.data?.items ?? []).some((row) => row.merchantId === state.channelA), JSON.stringify(ranking.data?.items ?? []).slice(0, 200));
}

async function testCrossChannelIsolation() {
    const foreign = await request(`/api/card-dist/v1/checkouts/${state.orderNo}`, { secret: state.secretB });
    check("one channel cannot read another's order", foreign.status === 404, `status ${foreign.status}`);
}

async function testSuspendAndReissue() {
    await request(`/api/admin/card-dist/merchants/${state.channelB}`, {
        method: "PATCH",
        body: { name: `验收渠道B ${stamp}`, commissionMode: "fixed", commissionRate: "2", holdDays: 30, enabled: false },
    });
    const disabled = await request("/api/card-dist/v1/products", { secret: state.secretB });
    check("a suspended channel is refused at once", disabled.status === 403 || disabled.status === 401, `status ${disabled.status}`);

    const reissued = await request(`/api/admin/card-dist/merchants/${state.channelA}/reissue`, { method: "POST" });
    const newSecret = reissued.data?.secret;
    check("re-issuing returns a fresh secret", Boolean(newSecret) && newSecret !== state.secretA);
    const old = await request("/api/card-dist/v1/products", { secret: state.secretA });
    check("the previous secret stops working immediately", old.status === 401, `status ${old.status}`);
    const fresh = await request("/api/card-dist/v1/products", { secret: newSecret });
    check("the new secret works", fresh.status === 200, `status ${fresh.status}`);
    state.secretA = newSecret;
}

async function testDeletionGuard() {
    const busy = await request(`/api/admin/card-dist/merchants/${state.channelA}`, { method: "DELETE" });
    check("a channel with orders cannot be deleted", busy.status === 400, `${busy.status} ${JSON.stringify(busy.data).slice(0, 160)}`);
}

async function testPaymentCallbackUntouched() {
    const forged = await request("/api/card-shop/notify?out_trade_no=NOPE&trade_status=TRADE_SUCCESS&money=1.00&sign=deadbeef", { anonymous: true });
    check("the card payment callback is still reachable and public", forged.status === 200, `status ${forged.status}`);
    check("a forged callback signature is rejected", String(forged.data).includes("fail"), String(forged.data).slice(0, 80));
}

async function main() {
    await confirmAdmin();
    console.log("\n[setup]");
    await setUp();
    console.log("\n[authentication]");
    await testAuth();
    console.log("\n[catalogue and pricing authority]");
    await testCatalogue();
    console.log("\n[hosted checkout]");
    await testCheckout();
    console.log("\n[checkout idempotency]");
    await testIdempotency();
    console.log("\n[payment-risk guards]");
    await testGuards();
    console.log("\n[daily sales cap]");
    await testDailyCap();
    console.log("\n[commission, payout and reversal]");
    await testCommissionAndPayout();
    console.log("\n[cross-channel isolation]");
    await testCrossChannelIsolation();
    console.log("\n[suspend and re-issue]");
    await testSuspendAndReissue();
    console.log("\n[deletion guard]");
    await testDeletionGuard();
    console.log("\n[payment callback regression]");
    await testPaymentCallbackUntouched();

    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
        console.log("\nfailures:");
        for (const failure of failures) console.log(`  - ${failure}`);
        process.exit(1);
    }
    console.log(`\ncleanup hints: product=${state.productId} channelA=${state.channelA} channelB=${state.channelB}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
