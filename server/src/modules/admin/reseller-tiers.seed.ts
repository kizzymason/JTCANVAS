import { sql } from "drizzle-orm";
import type { Database } from "../../db/db.module";
import { resellerTiers } from "../../db/schema";
import { toMoneyString } from "../../common/money";

/**
 * Tiers are seeded once so the very first approval has somewhere to land. `multiplier` is the signed
 * surcharge: the standard tier sells at list price, and the two others show an admin how markup and
 * discount are expressed without anybody having to guess the sign convention.
 */
const DEFAULT_TIERS: Array<{ name: string; multiplier: string; description: string; isDefault: boolean; sortOrder: number }> = [
    { name: "标准", multiplier: "0", description: "按平台公开价结算", isDefault: true, sortOrder: 10 },
    { name: "白银", multiplier: "-0.05", description: "公开价 95 折", isDefault: false, sortOrder: 20 },
    { name: "黄金", multiplier: "-0.1", description: "公开价 9 折", isDefault: false, sortOrder: 30 },
];

/** Seeds only when the table is empty, so an admin's edits survive a restart. */
export async function seedResellerTiers(db: Database) {
    return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('resellers.ensure-tiers'))`);

        const [counted] = await tx.select({ total: sql<number>`count(*)::int` }).from(resellerTiers);
        if ((counted?.total ?? 0) > 0) return { created: 0 };

        await tx.insert(resellerTiers).values(
            DEFAULT_TIERS.map((tier) => ({
                name: tier.name,
                multiplier: toMoneyString(tier.multiplier),
                description: tier.description,
                isDefault: tier.isDefault,
                sortOrder: tier.sortOrder,
            })),
        );
        return { created: DEFAULT_TIERS.length };
    });
}
