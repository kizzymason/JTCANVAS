import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { createPgClient } from "../../db/db.module";
import * as schema from "../../db/schema";
import { resellerAccounts, resellerTiers, users } from "../../db/schema";
import { ResellerAdminService } from "../admin/reseller.admin.service";
import { ApiKeyService } from "../openapi/api-key.service";
import { ResellerPricingService } from "../pricing/reseller-pricing.service";
import { ApplyResellerDto } from "./dto/reseller.dto";
import { ResellerService } from "./reseller.service";

const client = createPgClient(process.env.DATABASE_URL || "postgres://infinite:infinite@127.0.0.1:5442/infinite_canvas", 5);
const db = drizzle(client, { schema });
const cache = new Map<string, string>();
const redis = { get: async (key: string) => cache.get(key), set: async (key: string, value: string) => cache.set(key, value), del: async (key: string) => cache.delete(key) };
const pricing = new ResellerPricingService(db, redis as never);
const keys = new ApiKeyService(db, redis as never);
const service = new ResellerService(db, {} as never, pricing, {} as never, {} as never);
const admin = new ResellerAdminService(db, pricing, keys);
const input = { companyName: "测试团队", contactEmail: "test@example.com", website: "https://example.com", useCase: "为产品中的用户提供图像生成服务" };
let reviewer: string;
let tierId: string;
const userIds: string[] = [];
async function user() {
    const [row] = await db.insert(users).values({ username: `enroll_${randomUUID()}`, passwordHash: "test-only" }).returning();
    userIds.push(row.id);
    return row.id;
}
beforeAll(async () => {
    reviewer = await user();
    const [tier] = await db.insert(resellerTiers).values({ name: `discount_${randomUUID()}`, multiplier: "-0.1", isDefault: true }).returning();
    tierId = tier.id;
});
afterAll(async () => {
    try {
        if (userIds.length) {
            await db.delete(resellerAccounts).where(inArray(resellerAccounts.userId, userIds));
            await db.delete(users).where(inArray(users.id, userIds));
        }
        if (tierId) await db.delete(resellerTiers).where(eq(resellerTiers.id, tierId));
    } finally { await client.end({ timeout: 5 }); }
});

describe("direct enrollment and tier upgrades", () => {
    it("enrolls concurrently exactly once at list price, even when a default tier is discounted", async () => {
        const id = await user();
        const statuses = await Promise.all([service.status(id), service.status(id), service.assertAccess(id)]);
        expect(statuses[0]).toMatchObject({ canUseConsole: true, surcharge: "0.000000", multiplier: "1.000000", tierName: null });
        const rows = await db.select().from(resellerAccounts).where(eq(resellerAccounts.userId, id));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ tierId: null, multiplierOverride: null });
        const issued = await keys.create(id, {});
        expect(await keys.resolve(issued.plaintext)).toMatchObject({ resellerStatus: "approved", tierMultiplier: null });
    });

    it("allows a first upgrade request without prior landing-page access and keeps public pricing", async () => {
        const id = await user();
        expect(await service.apply(id, input)).toMatchObject({ status: "pending", canUseConsole: true, multiplier: "1.000000" });
        await expect(service.assertAccess(id)).resolves.toBeTruthy();
        await expect(service.apply(id, input)).rejects.toThrow();
        await admin.review(id, reviewer, { decision: "reject", rejectReason: "请补充产品说明" });
        expect(await service.status(id)).toMatchObject({ status: "rejected", canUseConsole: true, multiplier: "1.000000", rejectReason: "请补充产品说明" });
        await expect(service.assertAccess(id)).resolves.toBeTruthy();
        await service.apply(id, input);
        await admin.review(id, reviewer, { decision: "approve", tierId });
        expect(await service.status(id)).toMatchObject({ status: "approved", multiplier: "0.900000" });
    });

    it("preserves an existing discount, role and key while an upgrade is pending or rejected", async () => {
        const id = await user();
        await service.apply(id, input);
        await admin.review(id, reviewer, { decision: "approve", tierId });
        await admin.update(id, { multiplierOverride: "-0.2" });
        const issued = await keys.create(id, {});
        await keys.resolve(issued.plaintext);
        await service.apply(id, input);
        expect(await pricing.multiplierFor(id)).toBe("0.800000");
        await admin.review(id, reviewer, { decision: "reject", rejectReason: "暂不调整" });
        expect(await pricing.multiplierFor(id)).toBe("0.800000");
        expect(await service.status(id)).toMatchObject({ canUseConsole: true, multiplier: "0.800000" });
        expect(await keys.resolve(issued.plaintext)).toMatchObject({ status: "active", multiplierOverride: "-0.200000" });
        expect((await db.select().from(users).where(eq(users.id, id)))[0].role).toBe("reseller");
    });

    it("accepts only one concurrent submission and one concurrent review", async () => {
        const id = await user();
        const submitted = await Promise.allSettled([service.apply(id, input), service.apply(id, input)]);
        expect(submitted.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const reviewed = await Promise.allSettled([
            admin.review(id, reviewer, { decision: "approve", tierId }),
            admin.review(id, reviewer, { decision: "reject", rejectReason: "重复审核" }),
        ]);
        expect(reviewed.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });

    it("cannot reopen a suspended account through status, application, or stale review", async () => {
        const id = await user();
        await service.apply(id, input);
        await admin.update(id, { status: "suspended" });
        expect(await service.status(id)).toMatchObject({ canUseConsole: false, status: "suspended" });
        await expect(service.assertAccess(id, "admin")).rejects.toThrow();
        await expect(service.apply(id, input)).rejects.toThrow();
        await expect(admin.review(id, reviewer, { decision: "approve", tierId })).rejects.toThrow();
    });

    it("prevents a stale submit from overwriting a simultaneous suspension", async () => {
        const id = await user();
        await service.status(id);
        const ensure = (service as any).ensureEnrolled.bind(service);
        const spy = vi.spyOn(service as any, "ensureEnrolled").mockImplementationOnce(async () => {
            const before = await ensure(id);
            await admin.update(id, { status: "suspended" });
            return before;
        });
        try { await expect(service.apply(id, input)).rejects.toThrow(); } finally { spy.mockRestore(); }
        expect(await service.status(id)).toMatchObject({ status: "suspended", canUseConsole: false });
    });

    it("accepts the simplified form and rejects removed fields and pricing injection", async () => {
        const options = { whitelist: true, forbidNonWhitelisted: true };
        expect(await validate(plainToInstance(ApplyResellerDto, input), options)).toHaveLength(0);
        for (const field of ["contactName", "contactPhone", "expectedVolume", "tierId", "multiplierOverride"]) {
            expect(await validate(plainToInstance(ApplyResellerDto, { ...input, [field]: "invalid" }), options)).not.toHaveLength(0);
        }
    });

    it("prevents a stale approval from restoring a simultaneous suspension", async () => {
        const id = await user();
        await service.apply(id, input);
        const account = (admin as any).account.bind(admin);
        const spy = vi.spyOn(admin as any, "account").mockImplementationOnce(async () => {
            const before = await account(id);
            await db.update(resellerAccounts).set({ status: "suspended" }).where(eq(resellerAccounts.userId, id));
            return before;
        });
        try { await expect(admin.review(id, reviewer, { decision: "approve", tierId })).rejects.toThrow(); } finally { spy.mockRestore(); }
        expect(await service.status(id)).toMatchObject({ status: "suspended", canUseConsole: false });
    });
});
