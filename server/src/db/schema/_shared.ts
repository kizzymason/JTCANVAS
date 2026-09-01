import { numeric, timestamp } from "drizzle-orm/pg-core";
import { MONEY_SCALE } from "../../common/money";

/** Every money column in the system uses this exact type. */
export const moneyColumn = (name: string) => numeric(name, { precision: 18, scale: MONEY_SCALE });

export const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
export const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();
export const deletedAt = () => timestamp("deleted_at", { withTimezone: true });
