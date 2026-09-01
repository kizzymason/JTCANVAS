import { Injectable } from "@nestjs/common";
import { noUsableChannel } from "../../../common/errors";
import type { ApiFormat } from "../../pricing/pricing.types";
import { GeminiAdapter } from "./gemini.adapter";
import { OpenAiAdapter } from "./openai.adapter";
import { PiapiAdapter } from "./piapi.adapter";
import type { ProviderAdapter } from "./provider.types";

/** Maps a channel's dialect to its adapter. Adding a provider means adding one entry here. */
@Injectable()
export class ProviderRegistry {
    private readonly adapters: Map<ApiFormat, ProviderAdapter>;

    constructor(openai: OpenAiAdapter, gemini: GeminiAdapter, piapi: PiapiAdapter) {
        this.adapters = new Map<ApiFormat, ProviderAdapter>([
            ["openai", openai],
            ["gemini", gemini],
            ["piapi", piapi],
        ]);
    }

    resolve(format: ApiFormat): ProviderAdapter {
        const adapter = this.adapters.get(format);
        if (!adapter) throw noUsableChannel(`不支持的渠道协议：${format}`);
        return adapter;
    }
}
