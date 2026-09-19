/**
 * Checks the invariants the daily reconciliation job enforces, without waiting for 4am.
 *
 * For every channel the append-only commission ledger must sum to what we owe it, and no card may
 * appear in two sales. A mismatch means something wrote a balance outside a ledgered path, or a card
 * escaped the uniqueness constraint — either is the kind of thing that has to be caught by a query
 * rather than noticed by a customer.
 *
 * Usage: node acceptance-reconcile.mjs
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const channels = await sql`
    select m.id,
           m.name,
           m.commission_balance::text as balance,
           coalesce((select sum(amount) from card_merchant_ledger l where l.merchant_id = m.id), 0)::text as ledger_sum
    from card_merchants m
    order by m.created_at
`;

let bad = 0;
for (const row of channels) {
    const ok = Number(row.balance) === Number(row.ledger_sum);
    if (!ok) bad += 1;
    console.log(`${ok ? "ok  " : "FAIL"} ${row.name}: owed=${row.balance} ledger=${row.ledger_sum}`);
}

// One commission row per order: the guarantee that a replayed payment cannot pay a channel twice.
const [dupeCommission] = await sql`
    select count(1)::int as total
    from (select order_id from card_merchant_ledger
          where order_id is not null and type = 'commission'
          group by order_id having count(1) > 1) t
`;
console.log(`${dupeCommission.total === 0 ? "ok  " : "FAIL"} orders with commission counted twice: ${dupeCommission.total}`);

// One sale per card: the guarantee that a card cannot be delivered to two buyers.
const [dupeCards] = await sql`
    select count(1)::int as total
    from (select card_id from card_order_items where card_id is not null group by card_id having count(1) > 1) t
`;
console.log(`${dupeCards.total === 0 ? "ok  " : "FAIL"} cards sold more than once: ${dupeCards.total}`);

// Commission may never exceed what the buyer actually paid on that order.
const [overpaid] = await sql`
    select count(1)::int as total from card_orders where commission_amount > amount
`;
console.log(`${overpaid.total === 0 ? "ok  " : "FAIL"} orders whose commission exceeds the payment: ${overpaid.total}`);

// Paid channel orders should all carry a settled commission state.
const [stuck] = await sql`
    select count(1)::int as total
    from card_orders
    where merchant_id is not null and status = 'paid'
      and commission_amount > 0 and commission_state = 'pending'
`;
console.log(`${stuck.total === 0 ? "ok  " : "FAIL"} paid channel orders left un-accrued: ${stuck.total}`);

await sql.end();
const failures = bad + dupeCommission.total + dupeCards.total + overpaid.total + stuck.total;
console.log(`\n${channels.length} channels checked, ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
