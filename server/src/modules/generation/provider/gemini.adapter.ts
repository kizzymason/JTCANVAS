import { Injectable } from "@nestjs/common";
import axios, { type AxiosInstance } from "axios";
import { badRequest } from "../../../common/errors";
import type { Capability } from "../../pricing/pricing.types";
import { closestGeminiAspectRatio, geminiImageSize, parseImageDimensions } from "../image-size";
import { ProviderAdapter, type DeltaSink, type GeneratedBinary, type GenerationOutput, type GenerationRequest, type ProviderCredentials } from "./provider.types";

type GeminiPart = { text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } };
type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
};

/** Models that accept an explicit imageSize hint; others only take an aspect ratio. */
const IMAGE_SIZE_CAPABLE = /gemini-3|imagen/i;

@Injectable()
export class GeminiAdapter extends ProviderAdapter {
    readonly format = "gemini" as const;

    supports(capability: Capability) {
        // Video and audio were never supported through this dialect in the original client either.
        return capability === "image" || capability === "text";
    }

    async generate(credentials: ProviderCredentials, request: GenerationRequest, onDelta?: DeltaSink): Promise<GenerationOutput> {
        if (!this.supports(request.capability)) throw badRequest("GEMINI_UNSUPPORTED", "Gemini 调用格式暂不支持该能力，请改用 OpenAI 格式渠道");
        if (request.mask) throw badRequest("GEMINI_MASK_UNSUPPORTED", "Gemini 调用格式暂不支持蒙版编辑");

        const http = this.client(credentials, request.signal);
        return request.capability === "image" ? this.image(http, request) : this.text(http, request, onDelta);
    }

    private async image(http: AxiosInstance, request: GenerationRequest): Promise<GenerationOutput> {
        const parts: GeminiPart[] = [{ text: withSystemPrompt(request) }];
        for (const reference of request.references) parts.push({ inlineData: { mimeType: reference.mimeType, data: reference.body.toString("base64") } });

        // Gemini returns one image per call, so N images means N sequential calls.
        const binaries: GeneratedBinary[] = [];
        for (let index = 0; index < request.count; index += 1) {
            const response = await http.post<GeminiPayload>(`/v1beta/models/${encodeURIComponent(request.model)}:generateContent`, {
                contents: [{ role: "user", parts }],
                ...this.imageConfig(request),
            });
            validate(response.data);
            const found = collectInlineImages(response.data);
            if (!found.length) throw badRequest("GEMINI_NO_IMAGE", "Gemini 接口没有返回图片");
            binaries.push(...found);
        }
        return { binaries, actualQuantity: binaries.length };
    }

    private async text(http: AxiosInstance, request: GenerationRequest, onDelta?: DeltaSink): Promise<GenerationOutput> {
        const response = await http.post<NodeJS.ReadableStream>(
            `/v1beta/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`,
            {
                contents: [{ role: "user", parts: [{ text: request.prompt }] }],
                ...(request.systemPrompt ? { systemInstruction: { parts: [{ text: request.systemPrompt }] } } : {}),
            },
            { responseType: "stream" },
        );

        let text = "";
        let buffer = "";
        await new Promise<void>((resolve, reject) => {
            response.data.on("data", (chunk: Buffer) => {
                buffer += chunk.toString("utf8");
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const line of lines) {
                    if (!line.startsWith("data:")) continue;
                    const payload = line.slice(5).trim();
                    if (!payload) continue;
                    try {
                        const parsed = JSON.parse(payload) as GeminiPayload;
                        for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
                            if (!part.text) continue;
                            text += part.text;
                            onDelta?.(part.text);
                        }
                    } catch {
                        // Partial JSON across chunk boundaries; the next chunk completes it.
                    }
                }
            });
            response.data.on("end", () => resolve());
            response.data.on("error", (error: Error) => reject(error));
        });

        if (!text.trim()) throw badRequest("NO_CONTENT", "模型没有返回内容");
        return { binaries: [], text };
    }

    private imageConfig(request: GenerationRequest) {
        const value = (request.size ?? "").trim();
        if (!value || value.toLowerCase() === "auto") return {};
        const dimensions = parseImageDimensions(value);
        const aspectRatio = closestGeminiAspectRatio(dimensions ? `${dimensions.width}:${dimensions.height}` : value);
        const imageSize = IMAGE_SIZE_CAPABLE.test(request.model) ? geminiImageSize(request.quality, dimensions) : undefined;
        const image = { ...(aspectRatio ? { aspectRatio } : {}), ...(imageSize ? { imageSize } : {}) };
        return Object.keys(image).length ? { responseFormat: { image } } : {};
    }

    private client(credentials: ProviderCredentials, signal?: AbortSignal) {
        const base = credentials.baseUrl.trim().replace(/\/+$/, "");
        return axios.create({
            baseURL: base,
            headers: { "x-goog-api-key": credentials.apiKey },
            signal,
            timeout: 0,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
        });
    }
}

function validate(payload: GeminiPayload) {
    if (payload?.error?.message) throw badRequest("PROVIDER_ERROR", payload.error.message);
    const blocked = payload?.promptFeedback?.blockReason;
    if (blocked) throw badRequest("GEMINI_REJECTED", `Gemini 拒绝了本次请求：${blocked}`);
}

function collectInlineImages(payload: GeminiPayload): GeneratedBinary[] {
    const binaries: GeneratedBinary[] = [];
    for (const part of payload.candidates?.[0]?.content?.parts ?? []) {
        const inline = part.inlineData ?? part.inline_data;
        const data = inline && "data" in inline ? inline.data : undefined;
        if (!data) continue;
        const mimeType = (part.inlineData?.mimeType ?? part.inline_data?.mime_type) || "image/png";
        binaries.push({ body: Buffer.from(data, "base64"), mimeType });
    }
    return binaries;
}

function withSystemPrompt(request: GenerationRequest) {
    const system = request.systemPrompt?.trim();
    return system ? `${system}\n\n${request.prompt}` : request.prompt;
}
