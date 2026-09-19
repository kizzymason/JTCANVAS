import type { TaskResponse } from "../generation/generation.service";
import type { PublicModel } from "../pricing/pricing.types";
import { flattenMessageContent } from "../pricing/token-counter";
import type { ChatMessageDto } from "./dto/openai.dto";
import { invalidRequest } from "./openai-errors";

/**
 * Translation between the OpenAI wire protocol and this platform's internal generation request.
 * Kept as pure functions so the mapping is unit-testable without a database or a queue.
 */

/** Downstream sees the bare model name; the qualified `channelId::model` form is also accepted. */
export function publicModelId(model: PublicModel) {
    return model.modelName;
}

export type OpenAiModelObject = {
    id: string;
    object: "model";
    created: number;
    owned_by: string;
};

export function toModelObject(model: PublicModel, createdAt: number): OpenAiModelObject {
    return { id: publicModelId(model), object: "model", created: createdAt, owned_by: "jtcanvas" };
}

/**
 * One entry per model id. Several channels can serve the same name; the list is already ordered by
 * channel priority, so keeping the first match is the same channel the executor would pick.
 */
export function dedupeModels(models: PublicModel[]) {
    const seen = new Set<string>();
    const unique: PublicModel[] = [];
    for (const model of models) {
        const id = publicModelId(model);
        if (seen.has(id)) continue;
        seen.add(id);
        unique.push(model);
    }
    return unique;
}

export type VideoStatus = "queued" | "in_progress" | "completed" | "failed";

export function videoStatusFor(status: string): VideoStatus {
    if (status === "pending") return "queued";
    if (status === "running") return "in_progress";
    // `partial` means fewer seconds than requested were delivered, but a usable clip exists.
    if (status === "succeeded" || status === "partial") return "completed";
    return "failed";
}

export type VideoObject = {
    id: string;
    object: "video";
    model: string;
    status: VideoStatus;
    progress: number;
    created_at: number;
    completed_at: number | null;
    seconds: string;
    size: string;
    error: { code: string; message: string } | null;
};

export function toVideoObject(task: TaskResponse): VideoObject {
    const params = (task.params ?? {}) as Record<string, unknown>;
    const status = videoStatusFor(task.status);
    return {
        id: task.id,
        object: "video",
        model: task.modelName,
        status,
        progress: videoProgress(task, status),
        created_at: unixSeconds(task.createdAt),
        completed_at: task.finishedAt ? unixSeconds(task.finishedAt) : null,
        seconds: String(Math.floor(Number(params.seconds ?? 0)) || 0),
        size: typeof params.size === "string" && params.size ? params.size : String(params.resolution ?? ""),
        error: status === "failed" ? { code: "generation_failed", message: task.error || "Generation failed." } : null,
    };
}

function videoProgress(task: TaskResponse, status: VideoStatus) {
    if (status === "completed") return 100;
    if (status === "failed") return 0;
    if (status === "queued") return 0;
    if (!task.quantity) return 5;
    // Only whole clips are reported, so an in-flight task never claims to be finished.
    return Math.min(95, Math.round((task.succeededCount / task.quantity) * 100) || 5);
}

export type ImageResponseItem = { url?: string; b64_json?: string; revised_prompt?: string };

export type ChatUsage = {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
};

/**
 * `quantity` is the frozen token ceiling, not the reply, so usage is read from the counts the worker
 * writes back after settlement, falling back to the pre-call estimate for input.
 */
export function chatUsageFrom(task: TaskResponse): ChatUsage {
    const params = (task.params ?? {}) as Record<string, unknown>;
    const promptTokens = intField(params.actualInputTokens) || intField(params.inputTokens);
    const completionTokens = intField(params.actualOutputTokens);
    return { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };
}

/** Flattens a chat transcript into the single prompt string the generation pipeline takes. */
export function messagesToPrompt(messages: ChatMessageDto[]) {
    if (!messages?.length) throw invalidRequest("`messages` must contain at least one message.", "invalid_messages", "messages");

    const parts: string[] = [];
    for (const message of messages) {
        const content = flattenMessageContent(message.content).trim();
        if (!content) continue;
        // Roles are labelled so a multi-turn transcript keeps its structure in a single prompt.
        if (message.role === "system" || message.role === "developer") parts.push(`[system]\n${content}`);
        else if (message.role === "assistant") parts.push(`[assistant]\n${content}`);
        else if (message.role === "tool") parts.push(`[tool]\n${content}`);
        else parts.push(`[user]\n${content}`);
    }

    const prompt = parts.join("\n\n").trim();
    if (!prompt) throw invalidRequest("`messages` did not contain any text content.", "invalid_messages", "messages");
    return prompt;
}

/** OpenAI quality names, plus the legacy DALL·E spellings, mapped onto the platform's tiers. */
export function mapImageQuality(quality: string | undefined) {
    if (!quality || quality === "auto") return undefined;
    if (quality === "standard") return "medium";
    if (quality === "hd") return "high";
    return quality;
}

export function mapImageBackground(background: string | undefined) {
    if (background === "transparent") return "transparent";
    return undefined;
}

/**
 * Turns `1280x720` into the resolution tier the price table is keyed on. The short edge is what
 * every provider names a tier after, so a portrait 720x1280 clip prices the same as landscape.
 */
export function resolutionFromSize(size: string | undefined) {
    if (!size) return undefined;
    const match = /^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/.exec(size.trim());
    if (!match) return undefined;
    const shortEdge = Math.min(Number(match[1]), Number(match[2]));
    if (!Number.isFinite(shortEdge) || shortEdge < 1) return undefined;
    if (shortEdge <= 480) return "480";
    if (shortEdge <= 720) return "720";
    if (shortEdge <= 1080) return "1080";
    return "1080";
}

/** References must be fetchable by the worker, so only absolute http(s) URLs are accepted. */
export function assertReferenceUrls(urls: string[], param: string) {
    for (const url of urls) {
        if (!/^https?:\/\//i.test(url)) {
            throw invalidRequest(`\`${param}\` must be an absolute http(s) URL; data URLs and file ids are not supported.`, "invalid_reference", param);
        }
    }
    return urls;
}

export function unixSeconds(value: Date | string | null | undefined) {
    if (!value) return Math.floor(Date.now() / 1000);
    const time = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(time) ? Math.floor(time / 1000) : Math.floor(Date.now() / 1000);
}

function intField(value: unknown) {
    const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.floor(parsed);
}
