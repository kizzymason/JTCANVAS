import i18n from "@/i18n";
import { fileUrl } from "@/services/api/files";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { useModelStore } from "@/stores/use-model-store";
import type { ReferenceImage } from "@/types/image";
import { ApiError } from "./client";
import { streamText, submitGeneration, waitForTask, type GenerationTask } from "./generation";
import { ensureReferenceKeys } from "./reference-upload";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

export type GeneratedImageResult = { id: string; dataUrl: string; storageKey?: string };

type RequestOptions = { signal?: AbortSignal; source?: string };

/**
 * Text-to-image. All provider work happens server-side: this submits a task, waits for it, and maps
 * the resulting files to display URLs. `count` is sent as one task so billing has a single unit.
 */
export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<GeneratedImageResult[]> {
    return runImageTask(config, prompt, [], undefined, options);
}

/** Image-to-image and mask editing. References are uploaded first and passed by storage key. */
export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions): Promise<GeneratedImageResult[]> {
    return runImageTask(config, prompt, references, mask, options);
}

async function runImageTask(config: AiConfig, prompt: string, references: ReferenceImage[], mask: ReferenceImage | undefined, options?: RequestOptions) {
    const n = Math.max(1, Number(config.count) || 1);
    const model = config.model || config.imageModel;
    assertModel(model);

    try {
        const referenceKeys = await ensureReferenceKeys(references, options?.signal);
        const maskKeys = mask ? await ensureReferenceKeys([mask], options?.signal) : [];

        const task = await submitGeneration(
            {
                capability: "image",
                model,
                prompt,
                references: referenceKeys,
                mask: maskKeys[0],
                count: Math.max(1, n),
                size: config.size,
                quality: config.quality,
                background: config.background,
                source: options?.source ?? "",
            },
            // Reused across the whole wait so a network retry cannot start a second paid task.
            undefined,
        );

        const finished = await waitForTask(task.id, { signal: options?.signal });
        void useAuthStore.getState().refreshWallet();
        return toImageResults(finished);
    } catch (error) {
        throw toFriendlyError(error);
    }
}

function toImageResults(task: GenerationTask): GeneratedImageResult[] {
    if (!task.outputs.length) throw new Error(task.error || apiText("noImageReturned"));
    // `dataUrl` keeps its historical name but now holds a server URL; storageKey is what gets persisted.
    return task.outputs.map((output) => ({ id: output.id, dataUrl: fileUrl(output.storageKey), storageKey: output.storageKey }));
}

/**
 * Streaming text. Deltas arrive over SSE from the worker via Redis pub/sub, so `onDelta` keeps the
 * same contract the canvas already relies on for live node updates.
 */
export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (chunk: string) => void, options?: RequestOptions) {
    const model = config.model || config.textModel;
    assertModel(model);

    const prompt = messages
        .filter((message) => message.role !== "system")
        .map((message) => (typeof message.content === "string" ? message.content : message.content.map((part) => ("text" in part ? part.text : "")).join("\n")))
        .join("\n\n");

    try {
        const task = await submitGeneration({ capability: "text", model, prompt, reasoningEffort: config.reasoningEffort, source: options?.source ?? "" });
        const finished = await streamText(task.id, onDelta, { signal: options?.signal });
        void useAuthStore.getState().refreshWallet();
        if (finished.status === "failed") throw new Error(finished.error || apiText("requestFailed"));
        return finished.outputText || apiText("noContent");
    } catch (error) {
        throw toFriendlyError(error);
    }
}

/** Model listing now comes from the platform catalogue rather than a provider endpoint. */
export async function fetchImageModels() {
    await useModelStore.getState().load(true);
    return useModelStore
        .getState()
        .models.filter((model) => model.capability === "image")
        .map((model) => model.value);
}

export function resolveGeneratedImageUrl(result: GeneratedImageResult) {
    return result.storageKey ? fileUrl(result.storageKey) : result.dataUrl;
}

function assertModel(model: string) {
    if (!modelOptionName(model).trim()) throw new Error(apiText("modelRequired"));
}

/**
 * Turns backend error codes into the messages the UI already knows how to act on, so callers can
 * keep showing "top up" or "contact admin" without duplicating the mapping.
 */
export function toFriendlyError(error: unknown) {
    if (error instanceof ApiError) {
        if (error.code === "INSUFFICIENT_BALANCE") return new InsufficientBalanceError(error.message);
        if (error.code === "NO_USABLE_CHANNEL") return new Error(error.message);
        return new Error(error.message);
    }
    if (error instanceof DOMException && error.name === "AbortError") return error;
    return error instanceof Error ? error : new Error(String(error));
}

/** Lets the UI route the user to the top-up page instead of showing a generic failure. */
export class InsufficientBalanceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InsufficientBalanceError";
    }
}
