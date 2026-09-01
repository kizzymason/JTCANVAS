import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, moneyColumn, updatedAt } from "./_shared";
import { users } from "./users";

export const ledgerType = pgEnum("ledger_type", ["recharge", "redeem", "freeze", "settle", "refund", "admin_adjust"]);
export const orderStatus = pgEnum("order_status", ["pending", "paid", "failed", "cancelled"]);
export const cardStatus = pgEnum("card_status", ["unused", "used", "void"]);

export const wallets = pgTable(
    "wallets",
    {
        userId: uuid("user_id")
            .primaryKey()
            .references(() => users.id, { onDelete: "cascade" }),
        /** Spendable balance. Frozen funds are already subtracted from this. */
        balance: moneyColumn("balance").default("0").notNull(),
        /** Funds reserved by in-flight generation tasks. */
        frozen: moneyColumn("frozen").default("0").notNull(),
        /** Lifetime totals, maintained in the same transaction as the ledger for cheap reporting. */
        totalRecharged: moneyColumn("total_recharged").default("0").notNull(),
        totalSpent: moneyColumn("total_spent").default("0").notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        // Last line of defence: no code path may drive a wallet negative.
        check("wallets_balance_non_negative", sql`${table.balance} >= 0`),
        check("wallets_frozen_non_negative", sql`${table.frozen} >= 0`),
    ],
);

/**
 * Append-only. Never UPDATE or DELETE a row here; corrections are new rows.
 * `balanceAfter` is a snapshot written inside the same transaction, used by the reconciliation job.
 */
export const walletLedger = pgTable(
    "wallet_ledger",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        type: ledgerType("type").notNull(),
        /** Signed: positive adds spendable balance, negative removes it. */
        amount: moneyColumn("amount").notNull(),
        balanceAfter: moneyColumn("balance_after").notNull(),
        frozenAfter: moneyColumn("frozen_after").notNull(),
        /** Set for freeze/settle/refund rows so a task's full money history can be replayed. */
        taskId: uuid("task_id"),
        orderId: uuid("order_id"),
        cardId: uuid("card_id"),
        /** Admin user id for admin_adjust rows. */
        operatorId: uuid("operator_id"),
        note: text("note").default("").notNull(),
        metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
        createdAt: createdAt(),
    },
    (table) => [
        index("wallet_ledger_user_created_idx").on(table.userId, table.createdAt),
        index("wallet_ledger_task_idx").on(table.taskId),
        index("wallet_ledger_type_idx").on(table.type),
    ],
);

/**
 * Recharge orders. Card redemption and admin top-ups also create an order so that every increase in
 * balance has a single auditable origin, and a real payment gateway can be added without a schema change.
 */
export const orders = pgTable(
    "orders",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        orderNo: text("order_no").notNull().unique(),
        amount: moneyColumn("amount").notNull(),
        status: orderStatus("status").default("pending").notNull(),
        /** "card" | "admin" today; "wechat" | "alipay" once a gateway is wired in. */
        paymentProvider: text("payment_provider").notNull(),
        providerTxnId: text("provider_txn_id"),
        paidAt: timestamp("paid_at", { withTimezone: true }),
        metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [index("orders_user_created_idx").on(table.userId, table.createdAt), index("orders_status_idx").on(table.status)],
);

export const redeemCardBatches = pgTable("redeem_card_batches", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").default("").notNull(),
    faceValue: moneyColumn("face_value").notNull(),
    quantity: integer("quantity").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
});

export const redeemCards = pgTable(
    "redeem_cards",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        batchId: uuid("batch_id")
            .notNull()
            .references(() => redeemCardBatches.id, { onDelete: "cascade" }),
        code: text("code").notNull().unique(),
        faceValue: moneyColumn("face_value").notNull(),
        status: cardStatus("status").default("unused").notNull(),
        redeemedBy: uuid("redeemed_by").references(() => users.id, { onDelete: "set null" }),
        redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
        expiresAt: timestamp("expires_at", { withTimezone: true }),
        createdAt: createdAt(),
    },
    // The column-level unique on `code` is what stops a card being consumed twice; the status
    // transition guard in RedeemService relies on it.
    (table) => [index("redeem_cards_batch_idx").on(table.batchId), index("redeem_cards_status_idx").on(table.status)],
);
