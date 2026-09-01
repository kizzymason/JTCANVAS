import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: { "@": resolve(import.meta.dirname, "src") },
    },
    test: {
        globals: true,
        environment: "node",
        include: ["src/**/*.spec.ts", "test/**/*.spec.ts"],
        // The billing suite talks to a real Postgres, so serialise it to keep wallet rows predictable.
        fileParallelism: false,
    },
});
