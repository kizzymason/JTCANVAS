import { Injectable, Logger } from "@nestjs/common";
import axios, { type AxiosInstance } from "axios";
import { AppError, badRequest } from "../../../common/errors";
import type { Capability } from "../../pricing/pricing.types";
import { normalizeBackground, normalizeQuality, pricingSpec, resolveRequestSize } from "../image-size";
import { ProviderAdapter, type DeltaSink, type GeneratedBinary, type GenerationOutput, type GenerationRequest, type ProviderCredentials } from "./provider.types";
import {
    SEEDANCE_CREATE_PATHS,
    SEEDANCE_ENDPOINT_MISSING,
    asRecord,
    isSeedanceFailedStatus,
    isSeedanceSucceededStatus,
    seedanceCreateBody,
    seedanceStatusPaths,
    videoErrorMessage,
    videoResultUrl,
    videoTaskId,
} from "./seedance-video";

const VIDEO_POLL_INTERVAL_MS = 2500;
const VIDEO_MAX_ATTEMPTS = 720; // 30 minutes at 2.5s.

type ImageApiResponse = { data?: Array<Record<string, unknown>>; error?: { message?: string }; code?: number; msg?: string };
type VideoApiResponse = { id?: string; status?: string; error?: { message?: string }; url?: string; result_url?: string; video_url?: string };

/** OpenAI-compatible dialect: also covers the many relay services that mirror this API surface. */
@Injectable()
export class OpenAiAdapter extends ProviderAdapter {
    readonly format = "openai" as const;
    private readonly logger = new Logger(OpenAiAdapter.name);

    supports(_capability: Capability) {
        return true;
    }

    async generate(credentials: ProviderCredentials, request: GenerationRequest, onDelta?: DeltaSink): Promise<GenerationOutput> {
        const http = this.client(credentials, request.signal);
        if (request.capability === "image") return this.image(http, request);
        if (request.capability === "video") return this.video(http, request);
        if (request.capability === "audio") return this.audio(http, request);
        return this.text(http, request, onDelta);
    }

    private async image(http: AxiosInstance, request: GenerationRequest): Promise<GenerationOutput> {
        if (isSeedreamModel(request.model)) return this.seedreamImage(http, request);

        const quality = normalizeQuality(request.quality);
        const size = resolveRequestSize(quality, request.size, request.aspectPresets);
        const background = normalizeBackground(request.background);
        const prompt = withSystemPrompt(request);

        // Edits and generations are different endpoints; reference images decide which one applies.
        if (request.references.length) {
            const form = new FormData();
            form.append("model", request.model);
            form.append("prompt", prompt);
            form.append("n", String(request.count));
            if (size) form.append("size", size);
            if (quality) form.append("quality", quality);
            if (background) form.append("background", background);
            for (const reference of request.references) form.append("image[]", blobOf(reference.body, reference.mimeType), reference.fileName);
            if (request.mask) form.append("mask", blobOf(request.mask.body, request.mask.mimeType), request.mask.fileName);

            const response = await http.post<ImageApiResponse>("/v1/images/edits", form);
            return { binaries: await this.readImages(response.data) };
        }

        const response = await http.post<ImageApiResponse>("/v1/images/generations", {
            model: request.model,
            prompt,
            n: request.count,
            ...(size ? { size } : {}),
            ...(quality ? { quality } : {}),
            ...(background ? { background } : {}),
            // gpt-image-* rejects response_format; dall-e-* requires it to return base64.
            ...(request.model.startsWith("dall-e") ? { response_format: "b64_json" } : {}),
        });
        return { binaries: await this.readImages(response.data) };
    }

    /** ByteDance Seedream on OpenAI-compatible relays wants 1K/2K/4K size labels, not pixel strings. */
    private async seedreamImage(http: AxiosInstance, request: GenerationRequest): Promise<GenerationOutput> {
        const size = pricingSpec(request.quality, request.size, request.aspectPresets) || "2K";
        const ratio = (request.size ?? "").trim();
        const body: Record<string, unknown> = {
            model: request.model,
            prompt: withSystemPrompt(request),
            size,
            n: request.count,
            watermark: Boolean(request.watermark),
        };
        if (/^\d+(\.\d+)?:\d+(\.\d+)?$/.test(ratio)) body.aspect_ratio = ratio;
        if (request.references.length) {
            body.image = request.references.map((reference) => dataUrlOf(reference.body, reference.mimeType));
        }
        const response = await http.post<ImageApiResponse>("/v1/images/generations", body);
        return { binaries: await this.readImages(response.data) };
    }

    private async video(http: AxiosInstance, request: GenerationRequest): Promise<GenerationOutput> {
        if (isSeedanceModel(request.model)) return this.seedanceVideo(http, request);

        const form = new FormData();
        form.append("model", request.model);
        form.append("prompt", withSystemPrompt(request));
        if (request.seconds) form.append("seconds", String(request.seconds));
        const videoSize = resolveRequestSize("1K", request.size, request.aspectPresets);
        if (videoSize) form.append("size", videoSize);
        if (request.resolution) form.append("resolution", request.resolution);
        if (request.generateAudio !== undefined) form.append("generate_audio", String(request.generateAudio));
        if (request.watermark !== undefined) form.append("watermark", String(request.watermark));
        // The upstream caps reference inputs at 7.
        for (const reference of request.references.slice(0, 7)) form.append("input_reference[]", blobOf(reference.body, reference.mimeType), reference.fileName);

        const created = await http.post<VideoApiResponse>("/v1/videos", form);
        const taskId = created.data?.id;
        if (!taskId) throw badRequest("NO_VIDEO_TASK_ID", created.data?.error?.message || "视频接口没有返回任务 ID");
        return this.pollOpenAiVideo(http, taskId, request.signal);
    }

    /**
     * WhatsToken / NewAPI Seedance: POST `/v1/video/generations`. Do not fall back to Sora
     * `/v1/videos` — that 404s on the marketing host and never appears in the upstream log.
     */
    private async seedanceVideo(http: AxiosInstance, request: GenerationRequest): Promise<GenerationOutput> {
        const prompt = withSystemPrompt(request);
        const body = seedanceCreateBody({
            model: request.model,
            prompt,
            seconds: request.seconds,
            resolution: request.resolution,
            size: request.size,
            generateAudio: request.generateAudio,
            watermark: request.watermark,
            references: request.references.slice(0, 7).map((reference) => ({
                mimeType: reference.mimeType,
                url: publicOrDataUrl(reference),
            })),
        });

        let lastMissing: unknown;
        for (const path of SEEDANCE_CREATE_PATHS) {
            try {
                const created = await http.post<Record<string, unknown>>(path, body);
                const taskId = videoTaskId(created.data);
                if (!taskId) throw badRequest("NO_VIDEO_TASK_ID", videoErrorMessage(created.data) || "视频接口没有返回任务 ID");
                this.logger.log(`Seedance ${request.model} submitted via ${path} as ${taskId}`);
                return this.pollSeedanceVideo(http, taskId, request.signal);
            } catch (error) {
                if (error instanceof AppError) throw error;
                if (!isMissingEndpoint(error)) throw providerHttpError(error);
                lastMissing = error;
                this.logger.warn(`Seedance ${path} missing on ${request.model}, trying next path`);
            }
        }
        throw badRequest("VIDEO_ENDPOINT_NOT_FOUND", providerHttpMessage(lastMissing) || SEEDANCE_ENDPOINT_MISSING);
    }

    private async pollOpenAiVideo(http: AxiosInstance, taskId: string, signal?: AbortSignal): Promise<GenerationOutput> {
        for (let attempt = 0; attempt < VIDEO_MAX_ATTEMPTS; attempt += 1) {
            throwIfAborted(signal);
            await delay(VIDEO_POLL_INTERVAL_MS, signal);
            const polled = await http.get<VideoApiResponse>(`/v1/videos/${encodeURIComponent(taskId)}`);
            const status = (polled.data?.status || "").toLowerCase();
            if (status === "failed" || status === "error") throw badRequest("VIDEO_FAILED", polled.data?.error?.message || "视频生成失败");
            if (status !== "completed" && status !== "succeeded") continue;

            const directUrl = polled.data?.url || polled.data?.result_url || polled.data?.video_url;
            const binary = directUrl ? await fetchBinary(directUrl, signal) : await this.videoContent(http, taskId, signal);
            return { binaries: [binary], providerTaskId: taskId };
        }
        throw badRequest("VIDEO_TIMEOUT", "视频生成超时，请稍后重试");
    }

    private async pollSeedanceVideo(http: AxiosInstance, taskId: string, signal?: AbortSignal): Promise<GenerationOutput> {
        for (let attempt = 0; attempt < VIDEO_MAX_ATTEMPTS; attempt += 1) {
            throwIfAborted(signal);
            await delay(VIDEO_POLL_INTERVAL_MS, signal);
            const payload = await readSeedanceTask(http, taskId, signal);
            const status = String(payload.status || "");
            if (isSeedanceFailedStatus(status)) throw badRequest("VIDEO_FAILED", videoErrorMessage(payload) || "视频生成失败");
            const url = videoResultUrl(payload);
            if (!url) {
                if (!status || !isSeedanceSucceededStatus(status)) continue;
                throw badRequest("NO_VIDEO_RETURNED", "视频任务完成但没有返回文件");
            }
            return { binaries: [await fetchBinary(url, signal)], providerTaskId: taskId };
        }
        throw badRequest("VIDEO_TIMEOUT", "视频生成超时，请稍后重试");
    }

    private async videoContent(http: AxiosInstance, taskId: string, signal?: AbortSignal): Promise<GeneratedBinary> {
        const response = await http.get<ArrayBuffer>(`/v1/videos/${encodeURIComponent(taskId)}/content`, { responseType: "arraybuffer", signal });
        return { body: Buffer.from(response.data), mimeType: String(response.headers["content-type"] || "video/mp4") };
    }

    private async audio(http: AxiosInstance, request: GenerationRequest): Promise<GenerationOutput> {
        const response = await http.post<ArrayBuffer>(
            "/v1/audio/speech",
            {
                model: request.model,
                input: withSystemPrompt(request),
                voice: request.voice || "alloy",
                response_format: request.audioFormat || "mp3",
                ...(request.audioSpeed ? { speed: Number(request.audioSpeed) } : {}),
                ...(request.audioInstructions ? { instructions: request.audioInstructions } : {}),
            },
            { responseType: "arraybuffer" },
        );
        return { binaries: [{ body: Buffer.from(response.data), mimeType: String(response.headers["content-type"] || `audio/${request.audioFormat || "mpeg"}`) }] };
    }

    /**
     * Text goes through the Responses API with SSE. Chunks are pushed to `onDelta` as they arrive so
     * the caller can relay them to the browser; the full text is also returned for persistence.
     */
    private async text(http: AxiosInstance, request: GenerationRequest, onDelta?: DeltaSink): Promise<GenerationOutput> {
        const response = await http.post<NodeJS.ReadableStream>(
            "/v1/responses",
            {
                model: request.model,
                input: [
                    ...(request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : []),
                    { role: "user", content: request.prompt },
                ],
                stream: true,
                ...(request.reasoningEffort && request.reasoningEffort !== "auto" ? { reasoning: { effort: request.reasoningEffort } } : {}),
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
                    if (!payload || payload === "[DONE]") continue;
                    const delta = extractDelta(payload);
                    if (!delta) continue;
                    text += delta;
                    onDelta?.(delta);
                }
            });
            response.data.on("end", () => resolve());
            response.data.on("error", (error: Error) => reject(error));
        });

        if (!text.trim()) throw badRequest("NO_CONTENT", "模型没有返回内容");
        return { binaries: [], text };
    }

    private async readImages(payload: ImageApiResponse): Promise<GeneratedBinary[]> {
        if (payload?.error?.message) throw badRequest("PROVIDER_ERROR", payload.error.message);
        const items = payload?.data ?? [];
        if (!items.length) throw badRequest("NO_IMAGE_RETURNED", payload?.msg || "接口没有返回图片，请检查提示词是否触发安全审核");

        const binaries: GeneratedBinary[] = [];
        for (const item of items) {
            const base64 = typeof item.b64_json === "string" ? item.b64_json : undefined;
            if (base64) {
                binaries.push({ body: Buffer.from(base64, "base64"), mimeType: "image/png" });
                continue;
            }
            const url = typeof item.url === "string" ? item.url : undefined;
            // Provider result URLs expire, so mirror the bytes into our own storage immediately.
            if (url) binaries.push(await fetchBinary(url));
        }
        if (!binaries.length) throw badRequest("UNKNOWN_IMAGE_RESPONSE", `接口返回了未知格式的数据（字段：${Object.keys(items[0] ?? {}).join(", ")}）`);
        return binaries;
    }

    private client(credentials: ProviderCredentials, signal?: AbortSignal) {
        return axios.create({
            baseURL: normalizeBaseUrl(credentials.baseUrl),
            headers: { Authorization: `Bearer ${credentials.apiKey}` },
            signal,
            timeout: 0,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
        });
    }
}

/** Node's Buffer is backed by ArrayBufferLike, which BlobPart does not accept; copy the view. */
function blobOf(body: Buffer, mimeType: string) {
    return new Blob([new Uint8Array(body)], { type: mimeType });
}

/** Callers pass a base URL that may or may not already include /v1. */
function normalizeBaseUrl(baseUrl: string) {
    const trimmed = baseUrl.trim().replace(/\/+$/, "");
    return trimmed.toLowerCase().endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

function withSystemPrompt(request: GenerationRequest) {
    const system = request.systemPrompt?.trim();
    return system ? `${system}\n\n${request.prompt}` : request.prompt;
}

function extractDelta(payload: string) {
    try {
        const event = JSON.parse(payload) as { type?: string; delta?: string; text?: string };
        if (typeof event.delta === "string") return event.delta;
        if (event.type === "response.output_text.done" && typeof event.text === "string") return "";
        return "";
    } catch {
        return "";
    }
}

export async function fetchBinary(url: string, signal?: AbortSignal): Promise<GeneratedBinary> {
    const response = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer", signal, timeout: 0, maxContentLength: Infinity });
    return { body: Buffer.from(response.data), mimeType: String(response.headers["content-type"] || "application/octet-stream") };
}

export function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new Error("Aborted"));
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
        }, ms);
        function abort() {
            clearTimeout(timer);
            reject(new Error("Aborted"));
        }
        signal?.addEventListener("abort", abort, { once: true });
    });
}

export function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new Error("Aborted");
}

function isSeedreamModel(model: string) {
    return model.toLowerCase().includes("seedream");
}

function isSeedanceModel(model: string) {
    return model.toLowerCase().includes("seedance");
}

function dataUrlOf(body: Buffer, mimeType: string) {
    return `data:${mimeType || "application/octet-stream"};base64,${body.toString("base64")}`;
}

function publicOrDataUrl(reference: { body: Buffer; mimeType: string; publicUrl?: string }) {
    const url = reference.publicUrl?.trim() ?? "";
    if (/^https?:\/\//i.test(url)) return url;
    return dataUrlOf(reference.body, reference.mimeType);
}

function isMissingEndpoint(error: unknown) {
    if (!axios.isAxiosError(error)) return false;
    const status = error.response?.status;
    return status === 404 || status === 405;
}

function providerHttpMessage(error: unknown) {
    if (axios.isAxiosError(error)) {
        return videoErrorMessage(asRecord(error.response?.data)) || error.message;
    }
    return error instanceof Error ? error.message : "";
}

function providerHttpError(error: unknown): never {
    throw badRequest("PROVIDER_ERROR", providerHttpMessage(error) || "上游视频接口请求失败");
}

async function readSeedanceTask(http: AxiosInstance, taskId: string, signal?: AbortSignal) {
    let merged: Record<string, unknown> | undefined;
    let lastError: unknown;
    for (const path of seedanceStatusPaths(taskId)) {
        try {
            const response = await http.get<Record<string, unknown>>(path, { signal });
            const nested = asRecord(response.data?.data);
            const raw = asRecord(response.data) ?? {};
            const piece = nested ? { ...raw, ...nested } : raw;
            merged = merged ? { ...merged, ...piece } : piece;
            if (videoResultUrl(merged)) return merged;
            const status = String(merged.status || "");
            if (status && !isSeedanceSucceededStatus(status)) return merged;
        } catch (error) {
            lastError = error;
            if (!isMissingEndpoint(error)) throw providerHttpError(error);
        }
    }
    if (merged) return merged;
    throw badRequest("VIDEO_STATUS_UNKNOWN", providerHttpMessage(lastError) || "无法查询视频任务状态");
}

