/**
 * Removes the rows the card-distribution acceptance runs created, so a production database is not
 * left carrying test distributors and test card stock.
 *
 * Only touches records whose names carry the acceptance markers, and reports what it deleted so the
 * effect is auditable. Ledger rows go with their distributor via ON DELETE CASCADE — that is the one
 * place an append-only table may lose rows, and only because the whole account is going away.
 *
 * Usage: node acceptance-cleanup.mjs [--dry-run]
 */
import postgres from "postgres";

const DRY_RUN = process.argv.includes("--dry-run");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const MERCHANT_PATTERNS = ["验收渠道%", "并发渠道%", "验收商户%", "并发商户%"];
const PRODUCT_PATTERNS = ["渠道验收%", "验收商品%", "并发验收%", "兑换回归%"];

const merchants = await sql`select id, name, commission_balance::text as balance from card_merchants where name like any(${MERCHANT_PATTERNS}::text[])`;
const products = await sql`select id, name from card_products where name like any(${PRODUCT_PATTERNS}::text[])`;

console.log(`${merchants.length} acceptance channels, ${products.length} acceptance products`);
for (const merchant of merchants) console.log(`  channel ${merchant.name} (commission owed ${merchant.balance})`);
for (const product of products) console.log(`  product ${product.name}`);

if (DRY_RUN) {
    console.log("\ndry run: nothing deleted");
    await sql.end();
    process.exit(0);
}

const merchantIds = merchants.map((row) => row.id);
const productIds = products.map((row) => row.id);

if (merchantIds.length) {
    await sql`delete from card_merchants where id = any(${merchantIds}::uuid[])`;
}

if (productIds.length) {
    // Orders and stock reference the product; clear the dependents before the product itself.
    const orders = await sql`select id from card_orders where product_id = any(${productIds}::uuid[])`;
    if (orders.length) {
        await sql`delete from card_orders where id = any(${orders.map((row) => row.id)}::uuid[])`;
    }
    const batches = await sql`select id from redeem_card_batches where product_id = any(${productIds}::uuid[])`;
    if (batches.length) {
        const batchIds = batches.map((row) => row.id);
        await sql`delete from redeem_cards where batch_id = any(${batchIds}::uuid[])`;
        await sql`delete from redeem_card_batches where id = any(${batchIds}::uuid[])`;
    }
    await sql`delete from card_products where id = any(${productIds}::uuid[])`;
    console.log(`\ndeleted ${orders.length} orders and ${batches.length} card batches`);
}

const [remaining] = await sql`select count(1)::int as total from card_merchants`;
console.log(`deleted ${merchantIds.length} channels and ${productIds.length} products; ${remaining.total} channels remain`);

await sql.end();
