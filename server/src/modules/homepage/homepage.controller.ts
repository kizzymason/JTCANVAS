import { createHash } from "node:crypto";
import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AdminOnly, Audit, CurrentUser, Public, SkipSession } from "../../common/decorators";
import type { AuthUser } from "../../common/types";
import { StorageService } from "../storage/storage.service";
import { HomepageService } from "./homepage.service";
import { HomeConfigDto, HomeWorkDto } from "./dto/homepage.dto";

@Controller("homepage")
export class HomepageController {
    constructor(private readonly home: HomepageService, private readonly storage: StorageService) {}
    @Public() @SkipSession() @Get()
    @Header("Cache-Control", "no-store")
    list() { return this.home.publicHome(); }
    @Public() @SkipSession() @Get("config")
    @Header("Cache-Control", "no-store")
    config() { return this.home.publicConfig(); }
    @Public() @SkipSession() @Get("works")
    @Header("Cache-Control", "no-store")
    works() { return this.home.publicWorks(); }
    @Public() @SkipSession() @Get("works/:id")
    @Header("Cache-Control", "no-store")
    work(@Param("id", ParseUUIDPipe) id: string) { return this.home.work(id); }
    @Public() @SkipSession() @Get("media/:key")
    async media(@Param("key") key: string, @Query("variant") variant: string | undefined, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
        const file = await this.home.media(key);
        const selectedVariant = variant === "thumb" || variant === "medium" ? variant : undefined;
        const target = await this.storage.download(file, selectedVariant);
        // A cached redirect can outlive the signed object URL. Keep redirects uncached.
        if (target.kind === "redirect") {
            reply.header("Cache-Control", "no-store");
            return reply.redirect(target.url, 302);
        }
        const etag = `"${createHash("sha256").update(`${file.id}:${file.createdAt.toISOString()}:${selectedVariant || "original"}`).digest("base64url")}"`;
        reply.header("Cache-Control", "private, no-cache, must-revalidate").header("ETag", etag);
        const requestEtag = request.headers["if-none-match"];
        if (requestEtag?.split(",").some((value) => value.trim() === "*" || value.trim().replace(/^W\//, "") === etag)) {
            return reply.code(304).send();
        }
        if (target.kind === "internal") return reply.header("X-Accel-Redirect", target.path).header("Content-Type", file.mimeType).send();
        return reply.header("Content-Type", target.mimeType).header("Content-Length", target.body.byteLength).send(target.body);
    }
}

@AdminOnly()
@Controller("admin/homepage")
export class AdminHomepageController {
    constructor(private readonly home: HomepageService, private readonly storage: StorageService) {}
    @Get() list() { return this.home.admin(); }
    @Get("media/:key")
    async media(@Param("key") key: string, @CurrentUser() user: AuthUser, @Res() reply: FastifyReply) {
        const file = await this.home.adminMedia(key, user.id);
        const target = await this.storage.download(file);
        reply.header("Cache-Control", "no-store");
        if (target.kind === "redirect") return reply.redirect(target.url, 302);
        if (target.kind === "internal") return reply.header("X-Accel-Redirect", target.path).header("Content-Type", file.mimeType).send();
        return reply.header("Content-Type", target.mimeType).send(target.body);
    }
    @Patch() @Audit({ action: "homepage.update", targetType: "homepage" })
    save(@Body() body: HomeConfigDto, @CurrentUser() user: AuthUser) { return this.home.saveConfig(body, user.id); }
    @Post("initialize") @Audit({ action: "homepage.initialize", targetType: "homepage" })
    initialize() { return this.home.initialize(); }
    @Post("works") @Audit({ action: "homepage.work.create", targetType: "homepage_work" })
    create(@Body() body: HomeWorkDto, @CurrentUser() user: AuthUser) { return this.home.saveWork(null, body, user.id); }
    @Patch("works/:id") @Audit({ action: "homepage.work.update", targetType: "homepage_work" })
    update(@Param("id", ParseUUIDPipe) id: string, @Body() body: HomeWorkDto, @CurrentUser() user: AuthUser) { return this.home.saveWork(id, body, user.id); }
    @Delete("works/:id") @Audit({ action: "homepage.work.delete", targetType: "homepage_work" })
    remove(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) { return this.home.remove(id, user.id); }
}
