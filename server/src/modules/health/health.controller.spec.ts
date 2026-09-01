import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { IS_PUBLIC_KEY } from "../../common/decorators";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
    it("keeps liveness public and requires a session for metrics", () => {
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, HealthController.prototype.health)).toBe(true);
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, HealthController.prototype.ready)).toBe(true);
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, HealthController.prototype.metrics)).toBeFalsy();
    });
});
