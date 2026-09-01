import { Body, Controller, Get, Inject, Param, Post, Query, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import Redis from "ioredis";
import { CurrentUser, Idempotent } from "../../common/decorators";
import { REDIS_SUBSCRIBER } from "../../redis/redis.module";
import type { AuthUser } from "../../common/types";
import { PaginationDto } from "../wallet/dto/wallet.dto";
import { CreateGenerationDto } from "./dto/generation.dto";
import { GenerationService } from "./generation.service";
import { statusChannel, streamChannel } from "./generation.queue";

@ApiTags("generations")
@Controller("generations")
export class GenerationController {
    constructor(
        private readonly generation: GenerationService,
        @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
    ) {}

    @Post()
    // Without this, a double-click on Generate freezes funds twice.
    @Idempotent("generation.submit")
    @ApiOperation({ summary: "提交生成任务，冻结预估费用并入队" })
    submit(@CurrentUser() user: AuthUser, @Body() body: CreateGenerationDto) {
        return this.generation.submit(user.id, body);
    }

    @Get()
    @ApiOperation({ summary: "生成记录" })
    list(@CurrentUser() user: AuthUser, @Query() query: PaginationDto) {
        return this.generation.list(user.id, query);
    }

    @Get(":id")
    @ApiOperation({ summary: "查询单个任务状态，前端轮询用" })
    get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
        return this.generation.get(user.id, id);
    }

    @Post(":id/cancel")
    @ApiOperation({ summary: "取消尚未开始的任务并释放冻结" })
    cancel(@CurrentUser() user: AuthUser, @Param("id") id: string) {
        return this.generation.cancel(user.id, id);
    }

    /**
     * Text streaming. The worker publishes deltas to Redis; this endpoint relays them as SSE, which is
     * what lets any API instance serve any client without sticky sessions.
     */
    @Get(":id/stream")
    @ApiOperation({ summary: "文本生成流式输出（SSE）" })
    async stream(@CurrentUser() user: AuthUser, @Param("id") id: string, @Res() reply: FastifyReply) {
        // Ownership check before subscribing, so a user cannot listen to someone else's task.
        const task = await this.generation.get(user.id, id);

        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            // Prevents nginx from buffering the stream into uselessness.
            "X-Accel-Buffering": "no",
        });

        if (task.status === "succeeded" || task.status === "failed") {
            if (task.outputText) reply.raw.write(`data: ${JSON.stringify({ delta: task.outputText })}\n\n`);
            reply.raw.write(`data: ${JSON.stringify({ status: task.status, error: task.error })}\n\n`);
            return reply.raw.end();
        }

        const deltas = streamChannel(id);
        const status = statusChannel(id);
        const connection = this.subscriber.duplicate();
        const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 15_000);

        const close = async () => {
            clearInterval(heartbeat);
            await connection.quit().catch(() => undefined);
            if (!reply.raw.writableEnded) reply.raw.end();
        };

        connection.on("message", (channel, message) => {
            if (channel === deltas) {
                reply.raw.write(`data: ${JSON.stringify({ delta: message })}\n\n`);
                return;
            }
            reply.raw.write(`data: ${message}\n\n`);
            void close();
        });

        await connection.subscribe(deltas, status);
        reply.raw.on("close", () => void close());
    }
}
