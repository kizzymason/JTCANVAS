import "reflect-metadata";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { hash } from "@node-rs/argon2";
import { createPgClient } from "../db/db.module";
import * as schema from "../db/schema";

/**
 * Creates or promotes an administrator. Normally unnecessary because the first registered account
 * becomes admin automatically, but useful for recovery.
 *
 * Usage: npm run seed:admin -- <username> <password>
 */
async function main() {
    const [username, password] = process.argv.slice(2);
    if (!username || !password) throw new Error("Usage: npm run seed:admin -- <username> <password>");
    if (password.length < 8) throw new Error("Password must be at least 8 characters");

    const client = createPgClient(process.env.DATABASE_URL!, 1);
    const db = drizzle(client, { schema });
    try {
        const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
        const [existing] = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);

        if (existing) {
            await db.update(schema.users).set({ role: "admin", status: "active", passwordHash, updatedAt: new Date() }).where(eq(schema.users.id, existing.id));
            await db.insert(schema.wallets).values({ userId: existing.id }).onConflictDoNothing();
            console.log(`Promoted existing user "${username}" to admin and reset the password`);
            return;
        }

        const [created] = await db.insert(schema.users).values({ username, passwordHash, role: "admin" }).returning();
        await db.insert(schema.wallets).values({ userId: created.id });
        console.log(`Created admin "${username}"`);
    } finally {
        await client.end({ timeout: 5 });
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
