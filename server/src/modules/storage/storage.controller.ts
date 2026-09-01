import { Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CurrentUser } from "../../common/decorators";
import { badRequest } from "../../common/errors";
import type { AuthUser } from "../../common/types";
import { assertFileOwner, StorageService } from "./storage.service";

/** Uploads are capped here rather than globally so a large canvas payload is not rejected too. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

@ApiTags("files")
@Controller("files")
export class StorageController {
    constructor(private readonly storage: StorageService) {}

    @Post()
    @ApiOperation({ summary: "上传文件，返回 storageKey 供画布与素材引用" })
    async upload(@CurrentUser() user: AuthUser, @Req() request: FastifyRequest) {
        const part = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
        if (!part) throw badRequest("NO_FILE", "请求中没有文件");
        const body = await part.toBuffer();
        const file = await this.storage.save({ ownerId: user.id, body, mimeType: part.mimetype });
        return toFileResponse(file);
    }

    // Declared before the catch-all so "meta" is not read as a storage key.
    @Get("meta/:id")
    @ApiOperation({ summary: "按文件 id 读取元信息" })
    async meta(@CurrentUser() user: AuthUser, @Param("id") id: string) {
        return toFileResponse(assertFileOwner(await this.storage.findById(user.id, id)));
    }

    @Get(":storageKey")
    @ApiOperation({ summary: "读取文件，S3 走 302 签名 URL，本机盘走 nginx 内部重定向" })
    async download(@CurrentUser() user: AuthUser, @Param("storageKey") storageKey: string, @Query("variant") variant: string | undefined, @Res() reply: FastifyReply) {
        const file = assertFileOwner(await this.storage.findByStorageKey(user.id, storageKey));
        const target = await this.storage.download(file, variant);

        if (target.kind === "redirect") return reply.redirect(target.url, 302);
        if (target.kind === "internal") {
            // nginx serves the bytes; Node only authorised the request.
            return reply.header("X-Accel-Redirect", target.path).header("Content-Type", file.mimeType || "application/octet-stream").header("Cache-Control", "private, max-age=31536000, immutable").send();
        }
        return reply
            .header("Content-Type", target.mimeType || file.mimeType || "application/octet-stream")
            .header("Content-Length", String(target.body.byteLength))
            .header("Cache-Control", "private, max-age=3600")
            .send(target.body);
    }
}

export function toFileResponse(file: { id: string; storageKey: string; mimeType: string; bytes: number; width: number | null; height: number | null; durationMs: number | null }) {
    return {
        id: file.id,
        storageKey: file.storageKey,
        mimeType: file.mimeType,
        bytes: file.bytes,
        width: file.width,
        height: file.height,
        durationMs: file.durationMs,
        /** Relative so the frontend works behind any host or path prefix. */
        url: `/api/files/${encodeURIComponent(file.storageKey)}?v=2`,
        thumbUrl: `/api/files/${encodeURIComponent(file.storageKey)}?variant=thumb&v=2`,
        mediumUrl: `/api/files/${encodeURIComponent(file.storageKey)}?variant=medium&v=2`,
    };
}
