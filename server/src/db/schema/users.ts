import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_shared";

export const userRole = pgEnum("user_role", ["user", "admin"]);
export const userStatus = pgEnum("user_status", ["active", "disabled"]);

export const users = pgTable(
    "users",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        username: text("username").notNull().unique(),
        passwordHash: text("password_hash").notNull(),
        role: userRole("role").default("user").notNull(),
        status: userStatus("status").default("active").notNull(),
        displayName: text("display_name").default("").notNull(),
        /** Per-user generation defaults (size, quality, count, voice...). Not authoritative for billing. */
        preferences: text("preferences").default("{}").notNull(),
        lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [index("users_role_idx").on(table.role), index("users_created_at_idx").on(table.createdAt)],
);

/**
 * Sessions live in Redis for the hot path; this table is the audit trail (which device signed in when)
 * and lets an admin see and revoke a user's sessions without reading Redis.
 */
export const sessions = pgTable(
    "sessions",
    {
        id: text("id").primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        userAgent: text("user_agent").default("").notNull(),
        ip: text("ip").default("").notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        revokedAt: timestamp("revoked_at", { withTimezone: true }),
        createdAt: createdAt(),
    },
    (table) => [index("sessions_user_id_idx").on(table.userId), index("sessions_expires_at_idx").on(table.expiresAt)],
);
