import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalStorageDriver } from "./local.driver";

describe("LocalStorageDriver.download", () => {
    it("streams file bytes when nginx X-Accel is off", async () => {
        const root = await mkdtemp(join(tmpdir(), "ic-storage-"));
        try {
            const driver = new LocalStorageDriver(root, "/internal-files", false);
            const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
            await driver.put("owner/file.png", body, "image/png");
            const target = await driver.download("owner/file.png", "image/png");
            expect(target.kind).toBe("stream");
            if (target.kind !== "stream") return;
            expect(target.body.equals(body)).toBe(true);
            expect(target.mimeType).toBe("image/png");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("returns an internal redirect when X-Accel is on", async () => {
        const driver = new LocalStorageDriver("/tmp", "/internal-files", true);
        const target = await driver.download("owner/file.png", "image/png");
        expect(target).toEqual({ kind: "internal", path: "/internal-files/owner/file.png" });
    });
});
