import { Controller, Get, Param, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { FastifyReply } from "fastify";
import { Public } from "../../common/decorators";
import { StorageService } from "../storage/storage.service";
import { AnnouncementsService } from "./announcements.service";

@ApiTags("announcements")
@Controller("announcements")
export class AnnouncementsController {
    constructor(
        private readonly announcements: AnnouncementsService,
        private readonly storage: StorageService,
    ) {}

    @Public()
    @Get()
    @Throttle({ default: { limit: 60, ttl: 60_000 } })
    @ApiOperation({ summary: "已发布公告列表" })
    list() {
        return this.announcements.listPublished();
    }

    @Public()
    @Get("media/:storageKey")
    @ApiOperation({ summary: "公告正文中的公开图片" })
    async media(@Param("storageKey") storageKey: string, @Res() reply: FastifyReply) {
        const file = await this.announcements.mediaFile(storageKey);
        const target = await this.storage.download(file);
        if (target.kind === "redirect") return reply.redirect(target.url, 302);
        if (target.kind === "internal") {
            return reply.header("X-Accel-Redirect", target.path).header("Content-Type", file.mimeType || "application/octet-stream").header("Cache-Control", "public, max-age=86400").send();
        }
        return reply
            .header("Content-Type", target.mimeType || file.mimeType || "application/octet-stream")
            .header("Content-Length", String(target.body.byteLength))
            .header("Cache-Control", "public, max-age=86400")
            .send(target.body);
    }

    @Public()
    @Get(":idOrSlug")
    @Throttle({ default: { limit: 60, ttl: 60_000 } })
    @ApiOperation({ summary: "已发布公告详情，id 或 slug" })
    detail(@Param("idOrSlug") idOrSlug: string) {
        return this.announcements.getPublished(idOrSlug);
    }
}
