import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOperation } from "@nestjs/swagger";
import { Idempotent } from "../../common/decorators";
import { StorageService } from "../storage/storage.service";
import { clientIp, type ApiCaller, type RequestWithApiCaller } from "./api-key.guard";
import { ImageGenerationDto } from "./dto/openai.dto";
import { invalidRequest, upstreamError } from "./openai-errors";
import { mapImageBackground, type ImageResponseItem } from "./openai-mappers";
import { imageGenerationInput } from "./generation-input";
import { CurrentCaller, OpenApiEndpoint } from "./openapi.decorators";
import { OpenPlatformService } from "./open-platform.service";
import { TaskWaiterService } from "./task-waiter.service";

/**
 * `POST /v1/images/generations` is synchronous in the OpenAI protocol, so the request is held open
 * until the queued task lands. Downstream SDKs already expect a long-running call here.
 */
@OpenApiEndpoint()
@Controller("v1/images")
export class V1ImagesController {
    private readonly waitTimeoutMs: number;

    constructor(
        private readonly openapi: OpenPlatformService,
        private readonly waiter: TaskWaiterService,
        private readonly storage: StorageService,
        config: ConfigService,
    ) {
        this.waitTimeoutMs = config.get<number>("openPlatform.imageWaitTimeoutMs")!;
    }

    @Post(["generations", "edits"])
    @HttpCode(200)
    // Optional: the OpenAI protocol has no idempotency header, but honouring one costs nothing.
    @Idempotent("openapi.images", { optional: true })
    @ApiOperation({ summary: "生成图片（同步返回）" })
    async generations(@CurrentCaller() caller: ApiCaller, @Body() body: ImageGenerationDto, @Req() request: RequestWithApiCaller) {
        const ip = clientIp(request);
        const call = { endpoint: (request.url ?? "/v1/images/generations").split("?")[0]!.replace(/^\/api/, ""), capability: "image" as const, model: body.model, clientIp: ip };
        return this.openapi.runBilled(caller, call, async () => {
            const model = await this.openapi.resolveModel(caller, body.model, "image");
            const input = imageGenerationInput(body, model);
            if (call.endpoint.endsWith("/edits") && !input.referenceMedia.length) throw invalidRequest("image is required for image edits.", "invalid_reference", "image");

            const task = await this.openapi.submitTask(
                caller,
                {
                    capability: "image",
                    model: model.value,
                    prompt: body.prompt,
                    count: body.n ?? 1,
                    ...input,
                    background: mapImageBackground(body.background),
                    source: "openapi",
                },
                call,
            );

            const settled = await this.waiter.waitForCompletion(caller.userId, task.id, this.waitTimeoutMs);
            if (settled.status === "failed" || settled.status === "cancelled") {
                const failure = settled.params.providerFailure as { upstreamStatus?: number; upstreamCode?: string; param?: string } | undefined;
                if (failure?.upstreamStatus === 400 || failure?.upstreamStatus === 422) {
                    throw invalidRequest(settled.error || "Upstream rejected the request.", failure.upstreamCode, failure.param);
                }
                throw upstreamError(settled.error || "Image generation failed.", "generation_failed");
            }
            const data = await this.toImageData(caller.userId, settled.outputFileIds, body.response_format ?? "url");
            if (!data.length) throw upstreamError("The upstream returned no images.", "no_image_returned");

            return {
                result: {
                    created: Math.floor(Date.now() / 1000),
                    data,
                },
                usage: {
                    taskId: settled.id,
                    capability: "image",
                    model: body.model,
                    quantity: data.length,
                    billedAmount: settled.actualCost,
                },
            };
        });
    }

    /**
     * `url` hands back a signed link into our own storage, which keeps large payloads out of the JSON
     * response. When no public origin is configured the link cannot be minted, so base64 is used
     * instead of returning something the caller cannot fetch.
     */
    private async toImageData(userId: string, fileIds: string[], format: "url" | "b64_json"): Promise<ImageResponseItem[]> {
        const items: ImageResponseItem[] = [];
        for (const fileId of fileIds) {
            const file = await this.storage.findById(userId, fileId);
            if (!file) continue;
            if (format === "url") {
                const url = this.storage.signedPublicUrl(file.storageKey);
                if (url) {
                    items.push({ url });
                    continue;
                }
            }
            const body = await this.storage.read(file);
            items.push({ b64_json: body.toString("base64") });
        }
        return items;
    }
}
