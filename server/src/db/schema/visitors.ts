import { date, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared";
import { users } from "./users";

export const visitorKind = pgEnum("visitor_kind", ["human", "bot", "suspected"]);

export type VisitorKind = (typeof visitorKind.enumValues)[number];

/**
 * Raw page hits. Worker deletes rows older than 30 days; charts read visitor_daily_stats instead.
 */
export const visitorEvents = pgTable(
    "visitor_events",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        visitorId: text("visitor_id").notNull(),
        userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
        ip: text("ip").default("").notNull(),
        userAgent: text("user_agent").default("").notNull(),
        device: text("device").default("").notNull(),
        path: text("path").notNull(),
        kind: visitorKind("kind").notNull(),
        createdAt: createdAt(),
    },
    (table) => [
        index("visitor_events_created_idx").on(table.createdAt),
        index("visitor_events_kind_idx").on(table.kind),
        index("visitor_events_path_idx").on(table.path),
        index("visitor_events_visitor_idx").on(table.visitorId),
    ],
);

/**
 * Permanent daily rollup. path `*` is the site-wide total. Pruning visitor_events must not touch this.
 */
export const visitorDailyStats = pgTable(
    "visitor_daily_stats",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        statDate: date("stat_date", { mode: "string" }).notNull(),
        path: text("path").notNull(),
        kind: visitorKind("kind").notNull(),
        pv: integer("pv").default(0).notNull(),
        uv: integer("uv").default(0).notNull(),
    },
    (table) => [unique("visitor_daily_stats_date_path_kind_unique").on(table.statDate, table.path, table.kind), index("visitor_daily_stats_date_idx").on(table.statDate)],
);

/**
 * One successful registration per device fingerprint for 365 days. Postgres, not Redis, so a cache
 * flush cannot reopen the window. IP is stored for the 24-hour NAT-friendly cap, not the yearly lock.
 */
export const registrationLocks = pgTable(
    "registration_locks",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        fingerprintHash: text("fingerprint_hash").notNull().unique(),
        ip: text("ip").default("").notNull(),
        userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
        registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
        createdAt: createdAt(),
    },
    (table) => [index("registration_locks_ip_registered_idx").on(table.ip, table.registeredAt)],
);
