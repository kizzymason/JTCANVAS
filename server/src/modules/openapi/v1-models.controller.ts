import { Controller, Get, Param, Req } from "@nestjs/common";
import { ApiOperation } from "@nestjs/swagger";
import { clientIp, type ApiCaller, type RequestWithApiCaller } from "./api-key.guard";
import { modelNotFound } from "./openai-errors";
import { publicModelId, toModelObject } from "./openai-mappers";
import { CurrentCaller, OpenApiEndpoint } from "./openapi.decorators";
import { OpenPlatformService } from "./open-platform.service";

/** Catalogue discovery. Shape matches `GET https://api.openai.com/v1/models` exactly. */
@OpenApiEndpoint()
@Controller("v1")
export class V1ModelsController {
    constructor(private readonly openapi: OpenPlatformService) {}

    @Get("models")
    @ApiOperation({ summary: "列出该令牌可调用的模型" })
    async list(@CurrentCaller() caller: ApiCaller, @Req() request: RequestWithApiCaller) {
        return this.openapi.runBilled(caller, { endpoint: "/v1/models", clientIp: clientIp(request) }, async () => {
            const models = await this.openapi.listModels(caller);
            // A fixed timestamp per model is not available, so the catalogue reports "now" like most gateways.
            const created = Math.floor(Date.now() / 1000);
            return { result: { object: "list", data: models.map((model) => toModelObject(model, created)) }, usage: {} };
        });
    }

    @Get("models/:model")
    @ApiOperation({ summary: "查询单个模型" })
    async retrieve(@CurrentCaller() caller: ApiCaller, @Param("model") model: string, @Req() request: RequestWithApiCaller) {
        return this.openapi.runBilled(caller, { endpoint: `/v1/models/${model}`, model, clientIp: clientIp(request) }, async () => {
            const models = await this.openapi.listModels(caller);
            const matched = models.find((item) => publicModelId(item) === model || item.value === model);
            if (!matched) throw modelNotFound(model);
            return { result: toModelObject(matched, Math.floor(Date.now() / 1000)), usage: { model } };
        });
    }
}
