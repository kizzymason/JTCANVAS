import { apiGet, apiPost, idempotencyHeaders, newIdempotencyKey, type Paginated } from "./client";
import type { ModelCapability } from "./models";

export type TaskStatus = "pending" | "running" | "succeeded" | "partial" | "failed" | "cancelled";

export type TaskOutput = {
    id: string;
    /** Durable server reference; persist this in canvas metadata. */
    storageKey: string;
    mimeType: string;
    bytes: number;
    width: number | null;
    height: number | null;
    durationMs: number | null;
};

export type GenerationTask = {
    id: string;
    capability: ModelCapability;
    modelName: string;
    status: TaskStatus;
    prompt: string;
    quantity: number;
    succeededCount: number;
    estimatedCost: string;
    actualCost: string;
    outputFileIds: string[];
    /** Resolved output files, already ordered. */
    outputs: TaskOutput[];
    outputText: string;
    error: string;
    params: Record<string, unknown>;
    createdAt: string;
    finishedAt: string | null;
};

export type SubmitGenerationInput = {
    capability: ModelCapability;
    model: string;
    prompt: string;
    references?: string[];
    mask?: string;
    count?: number;
    size?: string;
    quality?: string;
    background?: string;
    seconds?: number;
    resolution?: string;
    generateAudio?: boolean;
    watermark?: boolean;
    voice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    reasoningEffort?: string;
    source?: string;
};

const TERMINAL: TaskStatus[] = ["succeeded", "partial", "failed", "cancelled"];
const POLL_INTERVAL_MS = 1500;

/** Freezing funds happens here, so every submit carries an idempotency key. */
export function submitGeneration(input: SubmitGenerationInput, idempotencyKey = newIdempotencyKey()) {
    return apiPost<GenerationTask>("/generations", input, idempotencyHeaders(idempotencyKey));
}

export function fetchTask(id: string) {
    return apiGet<GenerationTask>(`/generations/${id}`);
}

export function fetchTasks(params: { page: number; pageSize: number }) {
    return apiGet<Paginated<GenerationTask>>("/generations", { params });
}

export function cancelTask(id: string) {
    return apiPost<GenerationTask>(`/generations/${id}/cancel`);
}

export function isTerminal(status: TaskStatus) {
    return TERMINAL.includes(status);
}

/** Polls until the task reaches a terminal state, reporting each intermediate snapshot. */
export async function waitForTask(id: string, options?: { signal?: AbortSignal; onUpdate?: (task: GenerationTask) => void }) {
    for (;;) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const task = await fetchTask(id);
        options?.onUpdate?.(task);
        if (isTerminal(task.status)) return task;
        await delay(POLL_INTERVAL_MS, options?.signal);
    }
}

/**
 * Text generation streams over SSE. Deltas are pushed to `onDelta`; the promise resolves with the
 * final task once the stream closes.
 */
export function streamText(id: string, onDelta: (chunk: string) => void, options?: { signal?: AbortSignal }) {
    return new Promise<GenerationTask>((resolve, reject) => {
        const source = new EventSource(`/api/generations/${id}/stream`, { withCredentials: true });

        const finish = async (error?: Error) => {
            source.close();
            if (error) return reject(error);
            resolve(await fetchTask(id));
        };

        source.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data) as { delta?: string; status?: string; error?: string };
                if (payload.delta) onDelta(payload.delta);
                if (payload.status) void finish(payload.error ? new Error(payload.error) : undefined);
            } catch {
                // Heartbeat comments and malformed frames are ignored.
            }
        };
        // EventSource fires onerror on normal close too, so fall back to the task's final state.
        source.onerror = () => void finish();
        options?.signal?.addEventListener("abort", () => void finish(new DOMException("Aborted", "AbortError")), { once: true });
    });
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
        const timer = window.setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
        }, ms);
        function abort() {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        }
        signal?.addEventListener("abort", abort, { once: true });
    });
}
