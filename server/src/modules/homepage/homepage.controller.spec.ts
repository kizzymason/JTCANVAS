import "reflect-metadata";
import type { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { firstValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../../common/guards/auth.guard";
import { AuditInterceptor } from "../../common/interceptors/audit.interceptor";
import { AdminHomepageController, HomepageController } from "./homepage.controller";

function context(controller: typeof AdminHomepageController | typeof HomepageController, handler: Function) {
    const request = { cookies: { ic_session: "session" }, user: { id: "admin-id", username: "Admin" }, ip: "127.0.0.1", headers: { "user-agent": "test" } };
    return { getHandler: () => handler, getClass: () => controller, switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}
const adminMethods = ["list", "media", "save", "initialize", "create", "update", "remove"] as const;

describe("homepage HTTP authorization and audit", () => {
    it.each(adminMethods)("protects admin %s from anonymous and ordinary accounts", async (method) => {
        const sessions = { resolve: vi.fn() };
        const guard = new AuthGuard(new Reflector(), sessions as never, new ConfigService({ session: { cookieName: "ic_session" } }));
        const ctx = context(AdminHomepageController, AdminHomepageController.prototype[method]);
        sessions.resolve.mockResolvedValue(null);
        await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 401 });
        sessions.resolve.mockResolvedValue({ id: "user-id", role: "user" });
        await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 403 });
        sessions.resolve.mockResolvedValue({ id: "admin-id", role: "admin" });
        await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
    it.each(["list", "config", "works", "media", "work"] as const)("public %s does not wait for a session", async (method) => {
        const sessions = { resolve: vi.fn() };
        const guard = new AuthGuard(new Reflector(), sessions as never, new ConfigService({ session: { cookieName: "ic_session" } }));
        expect(await guard.canActivate(context(HomepageController, HomepageController.prototype[method]))).toBe(true);
        expect(sessions.resolve).not.toHaveBeenCalled();
    });
    it.each(["save", "initialize", "create", "update", "remove"] as const)("audits %s with actor, source IP and before/after, strips internal audit payload", async (method) => {
        const record = vi.fn(async () => undefined);
        const interceptor = new AuditInterceptor(new Reflector(), { record } as never);
        const response = { id: "target", audit: { targetId: "target", before: { title: "before" }, after: { title: "after" } } };
        expect(await firstValueFrom(interceptor.intercept(context(AdminHomepageController, AdminHomepageController.prototype[method]), { handle: () => of(response) }))).toEqual({ id: "target" });
        expect(record).toHaveBeenCalledWith(expect.objectContaining({ actorId: "admin-id", ip: "127.0.0.1", targetId: "target", before: response.audit.before, after: response.audit.after }));
    });

    it("revalidates cached public uploads only after checking their current homepage reference", async () => {
        const file = { id: "file-id", createdAt: new Date("2026-01-01T00:00:00.000Z"), mimeType: "image/webp" };
        const home = { media: vi.fn().mockResolvedValue(file) };
        const storage = { download: vi.fn().mockResolvedValue({ kind: "internal", path: "/internal-files/file.webp" }) };
        const controller = new HomepageController(home as never, storage as never);
        const reply = () => {
            const result: Record<string, unknown> = { headers: {} };
            result.header = vi.fn((name: string, value: string) => {
                (result.headers as Record<string, string>)[name] = value;
                return result;
            });
            result.code = vi.fn(() => result);
            result.send = vi.fn(() => result);
            return result as never;
        };

        const initial = reply();
        await controller.media("image:key", "medium", { headers: {} } as never, initial);
        const etag = (initial as never as { headers: Record<string, string> }).headers.ETag;
        expect((initial as never as { headers: Record<string, string> }).headers["Cache-Control"]).toBe("private, no-cache, must-revalidate");

        const cached = reply();
        await controller.media("image:key", "medium", { headers: { "if-none-match": etag } } as never, cached);
        expect((cached as never as { code: ReturnType<typeof vi.fn> }).code).toHaveBeenCalledWith(304);
        expect(home.media).toHaveBeenCalledTimes(2);
    });

    it("does not cache S3 redirects because their signed URLs expire", async () => {
        const home = { media: vi.fn().mockResolvedValue({ id: "file-id", createdAt: new Date(), mimeType: "image/webp" }) };
        const storage = { download: vi.fn().mockResolvedValue({ kind: "redirect", url: "https://storage.example/signed" }) };
        const controller = new HomepageController(home as never, storage as never);
        const result: Record<string, unknown> = { headers: {} };
        result.header = vi.fn((name: string, value: string) => { (result.headers as Record<string, string>)[name] = value; return result; });
        result.redirect = vi.fn(() => result);

        await controller.media("image:key", undefined, { headers: { "if-none-match": "*" } } as never, result as never);
        expect((result.headers as Record<string, string>)["Cache-Control"]).toBe("no-store");
        expect(result.redirect).toHaveBeenCalledWith("https://storage.example/signed", 302);
        expect(result.headers).not.toHaveProperty("ETag");
    });
});
