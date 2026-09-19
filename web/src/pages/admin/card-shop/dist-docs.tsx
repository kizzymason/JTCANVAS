import { Alert, Anchor, Table, Tabs, Tag, Typography } from "antd";
import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** Base URL the channel's server calls. Derived from wherever the console itself is served. */
function apiBase() {
    if (typeof window === "undefined") return "/api/card-dist/v1";
    return `${window.location.origin}/api/card-dist/v1`;
}

/** Wire-protocol examples are literal text, not translated copy. */
function snippets(base: string) {
    return {
        products: `curl ${base}/products \\
  -H "Authorization: Bearer $JT_CHANNEL_SECRET"

# => { "items": [{ "id": "...", "name": "...", "faceValue": "10.000000",
#                  "price": "9.900000", "stock": 128,
#                  "estimatedCommission": "1.485000" }],
#      "methods": [{ "method": "alipay", ... }] }`,
        checkout: `# 买家在你站内点「立即支付」时，由你的后端调用。
# reference 用你自己的订单号：重复提交同一个值不会重复下单、不会重复收款。
curl -X POST ${base}/checkouts \\
  -H "Authorization: Bearer $JT_CHANNEL_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{
        "productId": "<商品ID>",
        "quantity": 1,
        "email": "buyer@example.com",
        "reference": "your-order-10086",
        "method": "alipay",
        "returnUrl": "https://shop.example.com/pay/result"
      }'

# => { "orderNo": "C2026...", "accessToken": "…", "amount": "9.900000",
#      "commission": "1.485000",
#      "payUrl": "https://<收银台>/…", "qrcode": "…", "img": "…" }`,
        poll: `curl ${base}/checkouts/C2026xxxxxxxx \\
  -H "Authorization: Bearer $JT_CHANNEL_SECRET"

# 未付款
# => { "status": "pending", "codes": [] }
# 已付款
# => { "status": "paid", "paidAt": "…", "codes": ["ABCD-EFGH-…"],
#      "commission": "1.485000", "commissionState": "accrued" }`,
        stats: `curl ${base}/stats \\
  -H "Authorization: Bearer $JT_CHANNEL_SECRET"

# => { "grossSales": "…", "commissionTotal": "…",
#      "commissionBalance": "…",   // 累计应付给你的佣金
#      "commissionHeld": "…",      // 其中仍在冻结期内
#      "commissionPayable": "…",   // 可结算
#      "paidOut": "…",             // 已打给你的
#      "soldToday": "…", "dailySalesLimit": "…" }`,
        node: `// 下游后端。密钥只存在服务器环境变量里，永远不要发到浏览器。
const BASE = "${base}";
const SECRET = process.env.JT_CHANNEL_SECRET;

async function call(path, { method = "GET", body } = {}) {
    const response = await fetch(BASE + path, {
        method,
        headers: { Authorization: \`Bearer \${SECRET}\`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.message || "card api failed");
    return data;
}

// 1) 买家下单：用你自己的订单号做 reference，重试安全
export async function startCheckout(orderId, productId, quantity, email) {
    const checkout = await call("/checkouts", {
        method: "POST",
        body: { productId, quantity, email, reference: orderId, method: "alipay",
                returnUrl: "https://shop.example.com/pay/result" },
    });
    // 把 orderNo 存进你自己的订单表，后面靠它查状态
    return { orderNo: checkout.orderNo, qrcode: checkout.qrcode, payUrl: checkout.payUrl };
}

// 2) 你的前端轮询你自己的这个接口，它再来问我们
export async function checkOrder(orderNo) {
    const result = await call("/checkouts/" + encodeURIComponent(orderNo));
    return { status: result.status, codes: result.codes };
}`,
        php: `<?php
// 下游后端。$SECRET 放在服务器配置里，不要输出到页面。
const BASE = '${base}';
$SECRET = getenv('JT_CHANNEL_SECRET');

function jt_call(string $path, array $opts = []) {
    global $SECRET;
    $ch = curl_init(BASE . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $SECRET, 'Content-Type: application/json'],
        CURLOPT_CUSTOMREQUEST => $opts['method'] ?? 'GET',
        CURLOPT_POSTFIELDS => isset($opts['body']) ? json_encode($opts['body']) : null,
        CURLOPT_TIMEOUT => 20,
    ]);
    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $data = json_decode($raw, true);
    if ($code < 200 || $code >= 300) throw new Exception($data['message'] ?? 'card api failed');
    return $data;
}

// 下单
$checkout = jt_call('/checkouts', ['method' => 'POST', 'body' => [
    'productId' => $productId,
    'quantity'  => 1,
    'email'     => $buyerEmail,
    'reference' => $myOrderId,
    'method'    => 'alipay',
    'returnUrl' => 'https://shop.example.com/pay/result',
]]);

// 查状态取卡
$result = jt_call('/checkouts/' . urlencode($checkout['orderNo']));
if ($result['status'] === 'paid') { $codes = $result['codes']; }`,
        webhook: `// 成交回调：签名头 x-jt-signature: t=<unix秒>,v1=<hmac>
// 用原始请求体验签，不要先反序列化再重新序列化。
const crypto = require("crypto");

function verify(rawBody, header, secret) {
    const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=")));
    const timestamp = Number(parts.t);
    // 超过 5 分钟一律拒绝，抓到的旧请求就无法重放
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
    const expected = crypto.createHmac("sha256", secret).update(\`\${timestamp}.\${rawBody}\`).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(parts.v1 || "");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// order.paid 载荷
// { "event": "order.paid", "sentAt": "...", "data": {
//     "orderNo": "C2026...", "reference": "your-order-10086",
//     "quantity": 1, "amount": "9.900000", "commission": "1.485000" } }
//
// order.reversed：该单已退款，佣金已冲回，请同步你自己的账
//
// 回调只是省掉轮询，不是权威来源：忽略回调、只用 GET /checkouts/{orderNo} 也完全正确。`,
        widget: `<!-- 参考组件：放在你自己的页面里，请求的是你自己的后端，不含任何我们的密钥。
     样式随便改，它只是一个起点。 -->
<div id="card-shop"></div>
<style>
  #card-shop { font: 14px/1.6 system-ui, sans-serif; max-width: 380px; }
  #card-shop .row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
  #card-shop input, #card-shop button { padding: 8px 10px; border-radius: 8px; border: 1px solid #ddd; }
  #card-shop button { background: #111; color: #fff; border: 0; cursor: pointer; }
  #card-shop img { width: 200px; height: 200px; }
  #card-shop .code { font-family: ui-monospace, monospace; user-select: all; }
</style>
<script>
(() => {
  const root = document.getElementById("card-shop");
  root.innerHTML = \`
    <div class="row"><input id="cs-email" type="email" placeholder="收卡邮箱" /></div>
    <div class="row"><input id="cs-qty" type="number" min="1" value="1" />
      <button id="cs-buy">立即支付</button></div>
    <div id="cs-out"></div>\`;

  const out = (html) => (document.getElementById("cs-out").innerHTML = html);
  let timer = null;

  document.getElementById("cs-buy").onclick = async () => {
    const quantity = Number(document.getElementById("cs-qty").value) || 1;
    const email = document.getElementById("cs-email").value.trim();
    if (!email) return out("请填写收卡邮箱");

    // 走你自己的后端下单，它再调我们的 /checkouts
    const res = await fetch("/api/shop/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity, email }),
    });
    const data = await res.json();
    if (!data.orderNo) return out("下单失败，请稍后再试");

    // 二维码直接渲染在你的页面上，买家不需要跳出去
    out(data.qrcode
      ? \`<p>请扫码支付</p><img alt="付款二维码" src="\${data.img || data.qrcode}" />\`
      : \`<p><a href="\${data.payUrl}" target="_blank" rel="noopener">点此支付</a></p>\`);

    // 轮询你自己的后端，它再问我们要状态
    clearInterval(timer);
    timer = setInterval(async () => {
      const r = await fetch("/api/shop/status?orderNo=" + encodeURIComponent(data.orderNo));
      const s = await r.json();
      if (s.status === "paid") {
        clearInterval(timer);
        out("<p>支付成功，您的卡密：</p>" +
            s.codes.map((c) => \`<div class="code">\${c}</div>\`).join(""));
      }
    }, 2500);
  };
})();
</script>`,
    };
}

/**
 * Integration reference for sales channels, kept inside the admin console rather than published:
 * this is a B2B surface and the URL is not something end buyers should stumble onto.
 */
export function CardDistDocs() {
    const { t } = useTranslation();
    const scrollRef = useRef<HTMLDivElement>(null);
    const base = apiBase();
    const code = snippets(base);

    const endpointRows = [
        { method: "GET", path: "/products", note: t("admin.cardDist.docs.epProducts") },
        { method: "POST", path: "/checkouts", note: t("admin.cardDist.docs.epCheckout") },
        { method: "GET", path: "/checkouts/{orderNo}", note: t("admin.cardDist.docs.epPoll") },
        { method: "GET", path: "/orders", note: t("admin.cardDist.docs.epOrders") },
        { method: "GET", path: "/stats", note: t("admin.cardDist.docs.epStats") },
        { method: "GET", path: "/payouts", note: t("admin.cardDist.docs.epPayouts") },
    ];

    const errorRows = [
        { code: "CARD_OUT_OF_STOCK", when: t("admin.cardDist.docs.errStock") },
        { code: "CARD_QUANTITY_LIMIT", when: t("admin.cardDist.docs.errQuantity") },
        { code: "MERCHANT_PRODUCT_FORBIDDEN", when: t("admin.cardDist.docs.errScope") },
        { code: "MERCHANT_IP_FORBIDDEN", when: t("admin.cardDist.docs.errIp") },
        { code: "MERCHANT_RETURN_URL_FORBIDDEN", when: t("admin.cardDist.docs.errReturn") },
        { code: "PAYMENT_METHOD_INVALID", when: t("admin.cardDist.docs.errMethod") },
        { code: "FORBIDDEN", when: t("admin.cardDist.docs.errDaily") },
        { code: "UNAUTHORIZED", when: t("admin.cardDist.docs.errAuth") },
    ];

    return (
        <div ref={scrollRef} className="flex gap-8">
            <article className="flex min-w-0 flex-1 flex-col gap-8">
                <Alert type="warning" showIcon message={t("admin.cardDist.docs.secretWarnTitle")} description={t("admin.cardDist.docs.secretWarnBody")} />

                <Section id="dist-model" title={t("admin.cardDist.docs.model")}>
                    <p className="text-sm text-stone-600 dark:text-stone-300">{t("admin.cardDist.docs.modelBody")}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-600 dark:text-stone-300">
                        <li>{t("admin.cardDist.docs.modelPoint1")}</li>
                        <li>{t("admin.cardDist.docs.modelPoint2")}</li>
                        <li>{t("admin.cardDist.docs.modelPoint3")}</li>
                        <li>{t("admin.cardDist.docs.modelPoint4")}</li>
                    </ul>
                </Section>

                <Section id="dist-quickstart" title={t("admin.cardDist.docs.quickstart")}>
                    <Field label={t("admin.cardDist.docs.baseUrl")} value={base} />
                    <Field label={t("admin.cardDist.docs.authHeader")} value="Authorization: Bearer sk_cd_..." />
                    <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-stone-600 dark:text-stone-300">
                        <li>{t("admin.cardDist.docs.step1")}</li>
                        <li>{t("admin.cardDist.docs.step2")}</li>
                        <li>{t("admin.cardDist.docs.step3")}</li>
                        <li>{t("admin.cardDist.docs.step4")}</li>
                        <li>{t("admin.cardDist.docs.step5")}</li>
                    </ol>
                </Section>

                <Section id="dist-privacy" title={t("admin.cardDist.docs.privacy")}>
                    <Alert type="info" showIcon message={t("admin.cardDist.docs.privacyTitle")} description={t("admin.cardDist.docs.privacyBody")} />
                </Section>

                <Section id="dist-endpoints" title={t("admin.cardDist.docs.endpoints")}>
                    <Table
                        rowKey={(row) => `${row.method}${row.path}`}
                        size="small"
                        pagination={false}
                        dataSource={endpointRows}
                        columns={[
                            {
                                title: t("admin.cardDist.docs.method"),
                                dataIndex: "method",
                                width: 80,
                                render: (value: string) => <Tag color={value === "GET" ? "blue" : "green"}>{value}</Tag>,
                            },
                            { title: t("admin.cardDist.docs.path"), dataIndex: "path", width: 220, render: (value: string) => <span className="font-mono text-xs">{value}</span> },
                            { title: t("admin.cardDist.docs.note"), dataIndex: "note" },
                        ]}
                    />
                </Section>

                <Section id="dist-examples" title={t("admin.cardDist.docs.examples")}>
                    <Tabs
                        items={[
                            { key: "checkout", label: t("admin.cardDist.docs.tabCheckout"), children: <Code text={code.checkout} /> },
                            { key: "poll", label: t("admin.cardDist.docs.tabPoll"), children: <Code text={code.poll} /> },
                            { key: "products", label: t("admin.cardDist.docs.tabProducts"), children: <Code text={code.products} /> },
                            { key: "stats", label: t("admin.cardDist.docs.tabStats"), children: <Code text={code.stats} /> },
                        ]}
                    />
                </Section>

                <Section id="dist-sdk" title={t("admin.cardDist.docs.sdk")}>
                    <p className="text-sm text-stone-600 dark:text-stone-300">{t("admin.cardDist.docs.sdkBody")}</p>
                    <Tabs
                        items={[
                            { key: "node", label: "Node.js", children: <Code text={code.node} /> },
                            { key: "php", label: "PHP", children: <Code text={code.php} /> },
                        ]}
                    />
                </Section>

                <Section id="dist-widget" title={t("admin.cardDist.docs.widget")}>
                    <p className="text-sm text-stone-600 dark:text-stone-300">{t("admin.cardDist.docs.widgetBody")}</p>
                    <Code text={code.widget} />
                </Section>

                <Section id="dist-webhook" title={t("admin.cardDist.docs.webhook")}>
                    <p className="text-sm text-stone-600 dark:text-stone-300">{t("admin.cardDist.docs.webhookBody")}</p>
                    <Code text={code.webhook} />
                </Section>

                <Section id="dist-settlement" title={t("admin.cardDist.docs.settlement")}>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-stone-600 dark:text-stone-300">
                        <li>{t("admin.cardDist.docs.settle1")}</li>
                        <li>{t("admin.cardDist.docs.settle2")}</li>
                        <li>{t("admin.cardDist.docs.settle3")}</li>
                        <li>{t("admin.cardDist.docs.settle4")}</li>
                    </ul>
                </Section>

                <Section id="dist-errors" title={t("admin.cardDist.docs.errors")}>
                    <Table
                        rowKey="code"
                        size="small"
                        pagination={false}
                        dataSource={errorRows}
                        columns={[
                            { title: t("admin.cardDist.docs.errorCode"), dataIndex: "code", width: 260, render: (value: string) => <span className="font-mono text-xs">{value}</span> },
                            { title: t("admin.cardDist.docs.when"), dataIndex: "when" },
                        ]}
                    />
                </Section>

                <Section id="dist-limits" title={t("admin.cardDist.docs.limits")}>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-stone-600 dark:text-stone-300">
                        <li>{t("admin.cardDist.docs.limitCheckout")}</li>
                        <li>{t("admin.cardDist.docs.limitPoll")}</li>
                        <li>{t("admin.cardDist.docs.limitIdem")}</li>
                        <li>{t("admin.cardDist.docs.limitDaily")}</li>
                        <li>{t("admin.cardDist.docs.limitIp")}</li>
                    </ul>
                </Section>
            </article>

            <aside className="hidden w-44 shrink-0 xl:block">
                <Anchor
                    affix={false}
                    className="sticky top-2"
                    getContainer={() => scrollRef.current ?? window}
                    items={[
                        { key: "model", href: "#dist-model", title: t("admin.cardDist.docs.model") },
                        { key: "quickstart", href: "#dist-quickstart", title: t("admin.cardDist.docs.quickstart") },
                        { key: "privacy", href: "#dist-privacy", title: t("admin.cardDist.docs.privacy") },
                        { key: "endpoints", href: "#dist-endpoints", title: t("admin.cardDist.docs.endpoints") },
                        { key: "examples", href: "#dist-examples", title: t("admin.cardDist.docs.examples") },
                        { key: "sdk", href: "#dist-sdk", title: t("admin.cardDist.docs.sdk") },
                        { key: "widget", href: "#dist-widget", title: t("admin.cardDist.docs.widget") },
                        { key: "webhook", href: "#dist-webhook", title: t("admin.cardDist.docs.webhook") },
                        { key: "settlement", href: "#dist-settlement", title: t("admin.cardDist.docs.settlement") },
                        { key: "errors", href: "#dist-errors", title: t("admin.cardDist.docs.errors") },
                        { key: "limits", href: "#dist-limits", title: t("admin.cardDist.docs.limits") },
                    ]}
                />
            </aside>
        </div>
    );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
    return (
        <section id={id} className="scroll-mt-4">
            <h2 className="mb-3 text-base font-semibold text-stone-950 dark:text-stone-100">{title}</h2>
            {children}
        </section>
    );
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div className="mt-2 flex flex-wrap items-baseline gap-2 rounded border border-stone-200 px-3 py-2 dark:border-stone-800">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-500">{label}</span>
            <Typography.Text copyable={{ text: value }} className="break-all font-mono text-xs">
                {value}
            </Typography.Text>
        </div>
    );
}

function Code({ text }: { text: string }) {
    return (
        <div className="relative mt-2 overflow-hidden rounded border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900">
            <div className="absolute right-2 top-2 z-[1]">
                <Typography.Text copyable={{ text }} />
            </div>
            <pre className="hide-scrollbar overflow-x-auto p-3 pr-10 font-mono text-xs leading-relaxed text-stone-800 dark:text-stone-200">{text}</pre>
        </div>
    );
}
