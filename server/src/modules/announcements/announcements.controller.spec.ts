import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { IS_PUBLIC_KEY } from "../../common/decorators";
import { AnnouncementsController } from "./announcements.controller";

describe("AnnouncementsController", () => {
    it("keeps list, detail and media public so visitors can read notices without signing in", () => {
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, AnnouncementsController.prototype.list)).toBe(true);
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, AnnouncementsController.prototype.detail)).toBe(true);
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, AnnouncementsController.prototype.media)).toBe(true);
    });
});
