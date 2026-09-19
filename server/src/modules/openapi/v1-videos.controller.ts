import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import { ApiOperation } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { Idempotent } from "../../common/decorators";
import { StorageService } from "../storage/storage.service";
import { clientIp, type ApiCaller, type RequestWithApiCaller } from "./api-key.guard";
import { VideoCreateDto } from "./dto/openai.dto";
import { invalidRequest, upstreamError } from "./openai-errors";
import { assertReferenceUrls, resolutionFromSize, toVideoObject, videoStatusFor } from "./openai-mappers";
import { CurrentCaller, OpenApiEndpoint } from "./openapi.decorators";
import { OpenPlatformService } from "./open-platform.service";

/**
 * Video follows the OpenAI async job protocol: create returns immediately with `queued`, the caller
 * polls until `completed`, then downloads the bytes. Billing and key quota are both finalized by the
 * worker, so polling is read-only and can never charge the same task twice.
 */
@OpenApiEndpoint()
@Controller("v1/videos")
export class V1VideosController {
    constructor(
        private readonly openapi: OpenPlatformService,
        private readonly storage: StorageService,
    ) {}

    @Post()
    @HttpCode(200)
    @Idempotent("openapi.videos", { optional: true })
    @ApiOperation({ summary: "创建视频任务（异步）" })
    async create(@CurrentCaller() caller: ApiCaller, @Body() body: VideoCreateDto, @Req() request: RequestWithApiCaller) {
        const ip = clientIp(request);
        const call = { endpoint: "/v1/videos", capability: "video" as const, model: body.model, clientIp: ip };
        return this.openapi.runBilled(caller, call, async () => {
            const model = await this.openapi.resolveModel(caller, body.model, "video");
            const reference = body.input_reference?.image_url;
            const references = reference ? assertReferenceUrls([reference], "input_reference.image_url") : undefined;

            const task = await this.openapi.submitTask(
                caller,
                {
                    capability: "video",
                    model: model.value,
                    prompt: body.prompt,
                    count: body.n ?? 1,
                    seconds: body.seconds,
                    size: body.size,
                    resolution: body.resolution || resolutionFromSize(body.size),
                    generateAudio: body.generate_audio,
                    references,
                    source: "openapi",
                },
                { ...call, deferredUsage: true },
            );

            return {
                result: toVideoObject(task),
                usage: {
                    taskId: task.id,
                    capability: "video",
                    model: body.model,
                    quantity: task.quantity,
                    // The worker fills the final amount into this same log row.
                    billedAmount: "0",
                    deferred: true,
                },
            };
        });
    }

    @Get(":id")
    @ApiOperation({ summary: "查询视频任务状态" })
    async retrieve(@CurrentCaller() caller: ApiCaller, @Param("id") id: string, @Req() request: RequestWithApiCaller) {
        return this.openapi.runBilled(caller, { endpoint: `/v1/videos/${id}`, capability: "video", clientIp: clientIp(request) }, async () => {
            const task = await this.openapi.getTask(caller, id);
            if (task.capability !== "video") throw invalidRequest(`\`${id}\` is not a video job.`, "not_a_video", "id");
            return { result: toVideoObject(task), usage: { capability: "video", model: task.modelName } };
        });
    }

    @Get(":id/content")
    @ApiOperation({ summary: "下载视频内容" })
    async content(@CurrentCaller() caller: ApiCaller, @Param("id") id: string, @Req() request: RequestWithApiCaller, @Res() reply: FastifyReply) {
        return this.openapi.runBilled(caller, { endpoint: `/v1/videos/${id}/content`, capability: "video", clientIp: clientIp(request) }, async () => {
            const task = await this.openapi.getTask(caller, id);
            if (task.capability !== "video") throw invalidRequest(`\`${id}\` is not a video job.`, "not_a_video", "id");

            const status = videoStatusFor(task.status);
            if (status === "failed") throw upstreamError(task.error || "Generation failed.", "generation_failed");
            if (status !== "completed") throw invalidRequest("The video is not ready yet. Poll the job until its status is `completed`.", "video_not_ready");

            const fileId = task.outputFileIds[0];
            const file = fileId ? await this.storage.findById(caller.userId, fileId) : null;
            if (!file) throw upstreamError("The generated video is no longer available.", "content_unavailable");

            const body = await this.storage.read(file);
            const result = reply
                .header("content-type", file.mimeType || "video/mp4")
                .header("content-length", String(body.byteLength))
                .header("content-disposition", `attachment; filename="${task.id}.mp4"`)
                .send(body);
            return { result, usage: { capability: "video", model: task.modelName } };
        });
    }
}
