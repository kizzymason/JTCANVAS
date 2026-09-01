import { defineConfig } from "drizzle-kit";

export default defineConfig({
    schema: "./src/db/schema/index.ts",
    out: "./src/db/migrations",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DATABASE_URL || "postgres://infinite:infinite@127.0.0.1:5432/infinite_canvas",
    },
    strict: true,
    verbose: true,
});
