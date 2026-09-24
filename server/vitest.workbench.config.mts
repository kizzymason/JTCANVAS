import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: { alias: { "@": fileURLToPath(new URL("../web/src", import.meta.url)) } },
    test: { include: ["../web/tests/workbench.spec.ts"], environment: "node" },
});
