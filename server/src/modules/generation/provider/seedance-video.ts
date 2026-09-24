/**
 * Seedance on WhatsToken / NewAPI-style relays.
 *
 * WhatsToken (https://www.whatstoken.ai) is an OpenAI-compatible gateway. Video create is
 * POST `/v1/video/generations` (singular `video`). The Sora paths `/v1/videos` and
 * `/v1/videos/generations` 404 on that host and never reach their usage log.
 * The Ark-native POST `/api/v3/contents/generations/tasks` also exists as a fallback.
 */

export const SEEDANCE_CREATE_PATHS = [
    "/v1/video/generations",
    "/v1/videos/generations",
    "/api/v3/contents/generations/tasks",
] as const;

export type SeedanceReference = {
    mimeType: string;
    url: string;
    role?: "first_frame" | "last_frame" | "reference_image" | "reference_video" | "reference_audio";
};

export function seedanceStatusPaths(taskId: string) {
    const id = encodeURIComponent(taskId);
    return [
        `/v1/video/generations/${id}`,
        `/v1/tasks/${id}`,
        `/api/v3/contents/generations/tasks/${id}`,
        `/v1/videos/generations/${id}`,
        `/v1/videos/${id}`,
    ];
}

/** UI stores 480/720/1080/2160; WhatsToken and Ark want 480p/720p/1080p/4k. */
export function seedanceResolution(value: string | undefined) {
    const raw = (value ?? "").trim().replace(/p$/i, "");
    if (!raw || raw === "auto" || raw === "high" || raw === "medium") return "720p";
    if (raw === "low") return "480p";
    if (raw.toLowerCase() === "4k" || raw === "2160") return "4k";
    return `${raw}p`;
}

export function friendlySeedanceError(message: string) {
    const raw = message.trim();
    if (/output audio may be related to copyright/i.test(raw) || /copyright restrictions/i.test(raw)) {
        return "生成失败：输出音频可能涉及版权限制。请关闭「生成声音」后重试，或更换提示词。";
    }
    if (/parameter duration specified in the request is not valid/i.test(raw) || /duration.*not valid.*r2v/i.test(raw)) {
        return "该模型最低生成时长4S";
    }
    return raw;
}

export function seedanceAspectRatio(size: string | undefined) {
    const value = (size ?? "").trim();
    if (!value || value === "auto") return undefined;
    if (value.includes(":")) return value;
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return undefined;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return undefined;
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const divisor = gcd(width, height);
    return `${width / divisor}:${height / divisor}`;
}

export function seedanceCreateBody(input: {
    model: string;
    prompt: string;
    seconds?: number;
    resolution?: string;
    size?: string;
    generateAudio?: boolean;
    watermark?: boolean;
    seed?: number;
    cameraFixed?: boolean;
    webSearch?: boolean;
    references?: SeedanceReference[];
    /** Overrides the Seedance resolution vocabulary for models that use their own (e.g. `2k`). */
    upstreamResolution?: string;
    /** Some models reject text-to-video without an explicit ratio, so one is always sent. */
    requireRatio?: boolean;
}) {
    const resolution = input.upstreamResolution ?? seedanceResolution(input.resolution);
    const ratio = seedanceAspectRatio(input.size) ?? (input.requireRatio ? "16:9" : undefined);
    const duration = input.seconds || 5;
    const generateAudio = input.generateAudio ?? true;
    const watermark = Boolean(input.watermark);
    const content: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }];
    for (const reference of input.references ?? []) {
        const mime = reference.mimeType.toLowerCase();
        if (mime.startsWith("video/")) {
            content.push({ type: "video_url", video_url: { url: reference.url }, role: "reference_video" });
        } else if (mime.startsWith("audio/")) {
            content.push({ type: "audio_url", audio_url: { url: reference.url }, role: "reference_audio" });
        } else {
            content.push({ type: "image_url", image_url: { url: reference.url }, role: reference.role ?? "reference_image" });
        }
    }

    const metadata: Record<string, unknown> = {
        resolution,
        generate_audio: generateAudio,
        watermark,
    };
    if (ratio) metadata.ratio = ratio;

    const body: Record<string, unknown> = {
        model: input.model,
        prompt: input.prompt,
        duration,
        seconds: String(duration),
        size: resolution,
        resolution,
        generate_audio: generateAudio,
        watermark,
        content,
        metadata,
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
        ...(input.cameraFixed !== undefined ? { camera_fixed: input.cameraFixed } : {}),
        ...(input.webSearch !== undefined ? { web_search: input.webSearch } : {}),
    };
    // WhatsToken's documented gateway fields; content remains available for Ark fallback.
    const refs = input.references ?? [];
    const images = refs.filter((ref) => ref.mimeType.startsWith("image/"));
    const videos = refs.filter((ref) => ref.mimeType.startsWith("video/"));
    const audios = refs.filter((ref) => ref.mimeType.startsWith("audio/"));
    if (images.length) body.images = images.map((ref) => ({ url: ref.url, role: ref.role ?? "reference_image" }));
    if (videos.length) body.videos = videos.map((ref) => ref.url);
    if (audios.length) body.audios = audios.map((ref) => ref.url);
    if (ratio) {
        body.aspect_ratio = ratio;
        body.ratio = ratio;
    }
    return body;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function videoTaskId(payload: Record<string, unknown> | undefined) {
    if (!payload) return "";
    const nested = asRecord(payload.data);
    const id = payload.id ?? payload.task_id ?? nested?.id ?? nested?.task_id;
    return typeof id === "string" && id.trim() ? id.trim() : "";
}

export function videoErrorMessage(payload: Record<string, unknown> | undefined) {
    if (!payload) return "";
    const error = asRecord(payload.error);
    const nested = asRecord(payload.data);
    const nestedError = asRecord(nested?.error);
    const message = error?.message ?? nestedError?.message ?? payload.message ?? payload.msg ?? nested?.message;
    return typeof message === "string" ? message : "";
}

/** First element of `data` when the relay returns a list of results rather than a single object. */
function firstOf(value: unknown) {
    return Array.isArray(value) ? asRecord(value[0]) : undefined;
}

export function videoResultUrl(payload: Record<string, unknown>) {
    // MiniMax-style relays answer `{ data: [{ url }] }`; Seedance/Ark answer `{ data: { url } }`.
    const nested = asRecord(payload.data) ?? firstOf(payload.data);
    const output = asRecord(payload.output) ?? firstOf(payload.output) ?? asRecord(nested?.output);
    const content = asRecord(payload.content) ?? asRecord(nested?.content);
    const candidates = [
        payload.url,
        payload.result_url,
        payload.video_url,
        nested?.url,
        nested?.result_url,
        nested?.video_url,
        output?.url,
        output?.video_url,
        content?.url,
        content?.video_url,
    ];
    const found = candidates.find((item) => typeof item === "string" && item.trim());
    return typeof found === "string" ? found : "";
}

/** Completion tokens from a WhatsToken / NewAPI / Ark poll envelope. */
export function videoUsageTokens(payload: Record<string, unknown> | undefined) {
    if (!payload) return undefined;
    const nested = asRecord(payload.data) ?? firstOf(payload.data);
    const output = asRecord(payload.output) ?? firstOf(payload.output) ?? asRecord(nested?.output);
    const usage =
        asRecord(payload.usage) ??
        asRecord(nested?.usage) ??
        asRecord(output?.usage) ??
        asRecord(asRecord(payload.metadata)?.usage);
    const candidates = [
        usage?.completion_tokens,
        usage?.output_tokens,
        usage?.total_tokens,
        payload.completion_tokens,
        nested?.completion_tokens,
    ];
    for (const item of candidates) {
        const value = typeof item === "number" ? item : typeof item === "string" && item.trim() ? Number(item) : NaN;
        if (Number.isFinite(value) && value >= 1) return Math.floor(value);
    }
    return undefined;
}

export function isSeedanceFailedStatus(status: string) {
    const value = status.toLowerCase();
    return value === "failed" || value === "error" || value === "cancelled" || value === "canceled" || value === "expired";
}

export function isSeedanceSucceededStatus(status: string) {
    const value = status.toLowerCase();
    return value === "completed" || value === "succeeded" || value === "success";
}

export const SEEDANCE_ENDPOINT_MISSING =
    "上游没有 Seedance 视频接口。WhatsToken 应使用 POST /v1/video/generations，请检查渠道地址是否为 https://www.whatstoken.ai";
