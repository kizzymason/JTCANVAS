import { randomUUID } from "node:crypto";
import { Body, Controller, HttpCode, Post, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOperation } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { Idempotent } from "../../common/decorators";
import type { TaskResponse } from "../generation/generation.service";
import { clientIp, type ApiCaller, type RequestWithApiCaller } from "./api-key.guard";
import { ChatCompletionDto } from "./dto/openai.dto";
import { upstreamError } from "./openai-errors";
import { chatUsageFrom, messagesToPrompt, type ChatUsage } from "./openai-mappers";
import { CurrentCaller, OpenApiEndpoint } from "./openapi.decorators";
import { OpenPlatformService, type BilledCall } from "./open-platform.service";
import { TaskWaiterService } from "./task-waiter.service";

const SSE_HEADERS = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // nginx would otherwise buffer the stream into a single burst at the end.
    "X-Accel-Buffering": "no",
};

/**
 * `POST /v1/chat/completions`, both streaming and blocking.
 *
 * Streaming is the interesting case: the response has to start before the cost is known, so the
 * stream is opened first and the usage frame is emitted at the end from the settled task. That also
 * means a mid-stream failure cannot be reported as an HTTP status — it goes out as an error frame,
 * which is exactly what the OpenAI SDKs expect.
 */
@OpenApiEndpoint()
@Controller("v1/chat")
export class V1ChatController {
    private readonly waitTimeoutMs: number;

    constructor(
        private readonly openapi: OpenPlatformService,
        private readonly waiter: TaskWaiterService,
        config: ConfigService,
    ) {
        this.waitTimeoutMs = config.get<number>("openPlatform.textWaitTimeoutMs")!;
    }

    @Post("completions")
    @HttpCode(200)
    @Idempotent("openapi.chat", { optional: true })
    @ApiOperation({ summary: "对话补全，支持流式与非流式" })
    async completions(
        @CurrentCaller() caller: ApiCaller,
        @Body() body: ChatCompletionDto,
        @Req() request: RequestWithApiCaller,
        @Res({ passthrough: true }) reply: FastifyReply,
    ) {
        const ip = clientIp(request);
        const call = { endpoint: "/v1/chat/completions", capability: "text" as const, model: body.model, clientIp: ip };

        if (body.stream) {
            await this.openapi.runBilled(caller, call, () => this.streamCompletion(caller, body, call, reply));
            return;
        }

        const payload = await this.openapi.runBilled(caller, call, () => this.blockingCompletion(caller, body, call));
        reply.header("content-type", "application/json; charset=utf-8");
        return payload;
    }

    private async blockingCompletion(caller: ApiCaller, body: ChatCompletionDto, call: BilledCall) {
        const { task } = await this.submit(caller, body, call);
        const settled = await this.waiter.waitForCompletion(caller.userId, task.id, this.waitTimeoutMs);
        if (settled.status === "failed" || settled.status === "cancelled") {
            throw upstreamError(settled.error || "Completion failed.", "generation_failed");
        }
        const usage = chatUsageFrom(settled);
        return {
            result: {
                id: completionId(settled.id),
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: body.model,
                choices: [{ index: 0, message: { role: "assistant", content: settled.outputText ?? "" }, logprobs: null, finish_reason: "stop" }],
                usage,
            },
            usage: {
                taskId: settled.id,
                capability: "text",
                model: body.model,
                quantity: 1,
                inputTokens: usage.prompt_tokens,
                outputTokens: usage.completion_tokens,
                billedAmount: settled.actualCost,
            },
        };
    }

    private async streamCompletion(caller: ApiCaller, body: ChatCompletionDto, call: BilledCall, reply: FastifyReply) {
        const { task } = await this.submit(caller, body, call);
        const id = completionId(task.id);
        const created = Math.floor(Date.now() / 1000);

        reply.raw.writeHead(200, SSE_HEADERS);
        // The role-only opening frame is what the SDKs use to construct the assistant message.
        write(reply, chunkFrame(id, created, body.model, { role: "assistant", content: "" }, null));

        const heartbeat = setInterval(() => write(reply, ": ping\n\n"), 15_000);
        let settled: TaskResponse | null = null;

        try {
            for await (const event of this.waiter.streamText(caller.userId, task.id, this.waitTimeoutMs)) {
                if (event.type === "delta") {
                    write(reply, chunkFrame(id, created, body.model, { content: event.text }, null));
                    continue;
                }
                settled = event.task;
            }

            if (!settled || settled.status === "failed" || settled.status === "cancelled") {
                const message = settled?.error || "Completion failed.";
                write(reply, `data: ${JSON.stringify({ error: { message, type: "upstream_error", code: "generation_failed", param: null } })}\n\n`);
                write(reply, "data: [DONE]\n\n");
                return {
                    result: undefined,
                    usage: { taskId: task.id, capability: "text", model: body.model, status: "failed" as const, errorCode: "generation_failed", httpStatus: 200 },
                };
            }

            const usage = chatUsageFrom(settled);
            write(reply, chunkFrame(id, created, body.model, {}, "stop"));
            if (body.stream_options?.include_usage) write(reply, usageFrame(id, created, body.model, usage));
            write(reply, "data: [DONE]\n\n");

            return {
                result: undefined,
                usage: {
                    taskId: settled.id,
                    capability: "text",
                    model: body.model,
                    quantity: 1,
                    inputTokens: usage.prompt_tokens,
                    outputTokens: usage.completion_tokens,
                    billedAmount: settled.actualCost,
                },
            };
        } finally {
            clearInterval(heartbeat);
            if (!reply.raw.writableEnded) reply.raw.end();
        }
    }

    private async submit(caller: ApiCaller, body: ChatCompletionDto, call: BilledCall) {
        const model = await this.openapi.resolveModel(caller, body.model, "text");
        const task = await this.openapi.submitTask(
            caller,
            {
                capability: "text",
                model: model.value,
                prompt: messagesToPrompt(body.messages),
                // `max_completion_tokens` is the current name; `max_tokens` stays supported for old SDKs.
                maxOutputTokens: body.max_completion_tokens ?? body.max_tokens,
                reasoningEffort: body.reasoning_effort,
                source: "openapi",
            },
            call,
        );
        return { task, model };
    }
}

function completionId(taskId: string) {
    // Prefixed like OpenAI's own ids; the task id is embedded so support can trace a call back.
    return `chatcmpl-${taskId.replace(/-/g, "")}${randomUUID().slice(0, 4)}`;
}

function chunkFrame(id: string, created: number, model: string, delta: Record<string, unknown>, finishReason: string | null) {
    return `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
    })}\n\n`;
}

/** Final frame when `stream_options.include_usage` was requested: no choices, usage only. */
function usageFrame(id: string, created: number, model: string, usage: ChatUsage) {
    return `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [], usage })}\n\n`;
}

function write(reply: FastifyReply, frame: string) {
    if (reply.raw.writableEnded) return;
    reply.raw.write(frame);
}
