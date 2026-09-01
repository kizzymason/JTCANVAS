import i18n from "@/i18n";
import { fileUrl } from "@/services/api/files";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { submitGeneration, waitForTask } from "./generation";
import { toFriendlyError } from "./image";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type AudioGenerationResult = { url: string; storageKey: string; mimeType: string; bytes: number; durationMs?: number };

type RequestOptions = { signal?: AbortSignal; source?: string };

export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<AudioGenerationResult> {
    const model = config.model || config.audioModel;
    if (!modelOptionName(model).trim()) throw new Error(apiText("audioModelRequired"));

    try {
        const task = await submitGeneration({
            capability: "audio",
            model,
            prompt,
            count: 1,
            voice: config.audioVoice,
            audioFormat: config.audioFormat,
            audioSpeed: config.audioSpeed,
            audioInstructions: config.audioInstructions,
            source: options?.source ?? "",
        });

        const finished = await waitForTask(task.id, { signal: options?.signal });
        void useAuthStore.getState().refreshWallet();
        if (finished.status === "failed" || finished.status === "cancelled") throw new Error(finished.error || apiText("audioGenerationFailed"));
        const output = finished.outputs[0];
        if (!output) throw new Error(apiText("audioGenerationFailed"));
        return { url: fileUrl(output.storageKey), storageKey: output.storageKey, mimeType: output.mimeType, bytes: output.bytes, durationMs: output.durationMs ?? undefined };
    } catch (error) {
        throw toFriendlyError(error);
    }
}

/** Already persisted server-side; this only reshapes the result for existing callers. */
export async function storeGeneratedAudio(result: AudioGenerationResult, _format?: string) {
    return { url: result.url, storageKey: result.storageKey, bytes: result.bytes, mimeType: result.mimeType, durationMs: result.durationMs, width: 0, height: 0 };
}
