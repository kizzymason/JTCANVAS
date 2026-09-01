import i18n from "@/i18n";
import { fileUrl } from "@/services/api/files";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import { useAuthStore } from "@/stores/use-auth-store";
import type { ReferenceImage } from "@/types/image";
import { ensureReferenceKeys } from "./reference-upload";
import { fetchTask, submitGeneration, waitForTask, type GenerationTask } from "./generation";
import { toFriendlyError } from "./image";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type VideoGenerationResult = { url?: string; storageKey?: string; mimeType?: string; durationMs?: number; width?: number; height?: number; bytes?: number };
/** `provider` is kept for call-site compatibility; every task is now a server task. */
export type VideoGenerationTask = { id: string; provider: "server"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

type RequestOptions = { signal?: AbortSignal; source?: string };

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, options);
    const finished = await waitForTask(task.id, { signal: options?.signal });
    void useAuthStore.getState().refreshWallet();
    const state = toState(finished);
    if (state.status === "failed") throw new Error(state.error);
    if (state.status === "pending") throw new Error(apiText("videoTimeout", { provider: "" }));
    return state.result;
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const model = config.model || config.videoModel;
    if (!modelOptionName(model).trim()) throw new Error(apiText("videoModelRequired"));

    try {
        const referenceKeys = await ensureReferenceKeys(references, options?.signal);
        const task = await submitGeneration({
            capability: "video",
            model,
            prompt,
            references: referenceKeys,
            count: 1,
            seconds: Number(config.videoSeconds) || undefined,
            size: config.size,
            resolution: config.vquality,
            generateAudio: config.videoGenerateAudio === "true",
            watermark: config.videoWatermark === "true",
            source: options?.source ?? "",
        });
        return { id: task.id, provider: "server", model };
    } catch (error) {
        throw toFriendlyError(error);
    }
}

/** Polling survives a page reload because the task lives on the server, not in memory. */
export async function pollVideoGenerationTask(_config: AiConfig, task: VideoGenerationTask, _options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const current = await fetchTask(task.id);
    return toState(current);
}

function toState(task: GenerationTask): VideoGenerationTaskState {
    if (task.status === "failed" || task.status === "cancelled") return { status: "failed", error: task.error || apiText("videoGenerationFailed") };
    if (task.status !== "succeeded" && task.status !== "partial") return { status: "pending" };
    const output = task.outputs[0];
    if (!output) return { status: "failed", error: apiText("noPlayableVideo") };
    return {
        status: "completed",
        result: {
            url: fileUrl(output.storageKey),
            storageKey: output.storageKey,
            mimeType: output.mimeType,
            durationMs: output.durationMs ?? undefined,
            width: output.width ?? undefined,
            height: output.height ?? undefined,
            bytes: output.bytes,
        },
    };
}

/**
 * Results are already persisted server-side, so this just normalises the shape the callers expect
 * instead of downloading and re-storing the bytes.
 */
export async function storeGeneratedVideo(result: VideoGenerationResult) {
    return {
        url: result.url ?? "",
        storageKey: result.storageKey ?? "",
        bytes: result.bytes ?? 0,
        mimeType: result.mimeType ?? "video/mp4",
        durationMs: result.durationMs,
        width: result.width ?? 0,
        height: result.height ?? 0,
    };
}
