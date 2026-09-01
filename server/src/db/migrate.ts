import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createPgClient } from "./db.module";

/** Run with `npm run db:migrate`. Applied on container start before the API accepts traffic. */
async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required to run migrations");

    // A dedicated single connection: migrations must not compete with the app pool.
    const client = createPgClient(url, 1);
    try {
        await migrate(drizzle(client), { migrationsFolder: resolve(__dirname, "migrations") });
        console.log("migrations applied");
    } finally {
        await client.end({ timeout: 5 });
    }
}

main().catch((error) => {
    console.error("migration failed:", error);
    process.exit(1);
});
