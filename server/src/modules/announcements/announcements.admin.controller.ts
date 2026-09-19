import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { AdminOnly, Audit, CurrentUser } from "../../common/decorators";
import { badRequest } from "../../common/errors";
import type { AuthUser } from "../../common/types";
import { AnnouncementQueryDto, UpsertAnnouncementDto } from "./dto/announcements.dto";
import { AnnouncementsService } from "./announcements.service";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

@ApiTags("admin")
@AdminOnly()
@Controller("admin/announcements")
export class AdminAnnouncementsController {
    constructor(private readonly announcements: AnnouncementsService) {}

    @Get()
    @ApiOperation({ summary: "公告列表（含未发布）" })
    list(@Query() query: AnnouncementQueryDto) {
        return this.announcements.listAdmin(query);
    }

    @Post("images")
    @ApiOperation({ summary: "上传公告正文图片，返回可公开访问的 URL" })
    async uploadImage(@CurrentUser() user: AuthUser, @Req() request: FastifyRequest) {
        const part = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
        if (!part) throw badRequest("NO_FILE", "请求中没有文件");
        const body = await part.toBuffer();
        return this.announcements.uploadImage({ ownerId: user.id, body, mimeType: part.mimetype });
    }

    @Post()
    @Audit({ action: "announcement.create", targetType: "announcement" })
    @ApiOperation({ summary: "发布公告" })
    create(@CurrentUser() user: AuthUser, @Body() body: UpsertAnnouncementDto) {
        return this.announcements.create(body, user.id);
    }

    @Patch(":id")
    @Audit({ action: "announcement.update", targetType: "announcement" })
    @ApiOperation({ summary: "修改公告" })
    update(@Param("id") id: string, @Body() body: UpsertAnnouncementDto) {
        return this.announcements.update(id, body);
    }

    @Delete(":id")
    @Audit({ action: "announcement.delete", targetType: "announcement" })
    @ApiOperation({ summary: "删除公告" })
    remove(@Param("id") id: string) {
        return this.announcements.remove(id);
    }
}
