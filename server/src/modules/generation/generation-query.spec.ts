import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { GenerationQueryDto } from "./dto/generation.dto";
import { GenerationService } from "./generation.service";

describe("workbench history filters", () => {
    it("accepts capability and active filters while rejecting arbitrary filters", async () => {
        const query = plainToInstance(GenerationQueryDto, { capability: "video", status: "active", page: "2", pageSize: "20" });
        expect(await validate(query, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
        expect(query.page).toBe(2);
        for (const input of [{ capability: "other" }, { status: "failed" }, { ownerId: "another-account" }]) {
            expect((await validate(plainToInstance(GenerationQueryDto, input), { whitelist: true, forbidNonWhitelisted: true })).length).toBeGreaterThan(0);
        }
    });

    it("keeps the authenticated owner constraint in both list and count queries", async () => {
        const predicates: SQL[] = [];
        const builder = (counted: boolean) => ({
            from() { return this; },
            where(where: SQL) { predicates.push(where); return this; },
            orderBy() { return this; },
            limit() { return this; },
            offset() { return this; },
            then(resolve: (rows: unknown[]) => unknown) { return Promise.resolve(counted ? [{ total: 0 }] : []).then(resolve); },
        });
        const service = Object.create(GenerationService.prototype) as GenerationService;
        Reflect.set(service, "db", { select: (fields?: unknown) => builder(Boolean(fields)) });
        Reflect.set(service, "withOutputs", vi.fn(async (items) => items));
        const result = await service.list("authenticated-owner", { capability: "image", status: "active", page: 1, pageSize: 20 });
        expect(result.total).toBe(0);
        expect(predicates).toHaveLength(2);
        const dialect = new PgDialect();
        for (const predicate of predicates) {
            const compiled = dialect.sqlToQuery(predicate);
            expect(compiled.sql).toContain('"user_id" =');
            expect(compiled.sql).toContain('"capability" =');
            expect(compiled.sql).toContain('"status" in');
            expect(compiled.params).toEqual(["authenticated-owner", "image", "pending", "running"]);
        }
    });
});
