import { create } from "zustand";
import { ApiError, newIdempotencyKey } from "@/services/api/client";
import { deleteTask, fetchTasks, isTerminal, submitGeneration, waitForTask, type GenerationTask, type SubmitGenerationInput } from "@/services/api/generation";
import { useAuthStore } from "@/stores/use-auth-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";

export type StudioKind = "image" | "video";
export type StudioTask = {
    id: string;
    createdAt: string;
    input?: SubmitGenerationInput;
    task?: GenerationTask;
    submitting?: boolean;
    error?: string;
    uncertain?: boolean;
    agentTaskId?: string;
};

type State = {
    entries: Record<string, StudioTask>;
    submit: (inputs: SubmitGenerationInput[], agentTaskId?: string) => Promise<void>;
    retrySubmission: (id: string) => Promise<void>;
    removeTask: (id: string) => Promise<void>;
    ingest: (tasks: GenerationTask[]) => void;
    resume: (id: string) => void;
    recover: (kind: StudioKind) => Promise<void>;
};

// Memory is a view cache only. The server owns history and continues running tasks across routes/reloads.
const watchers = new Map<string, AbortController>();
let session = 0;
const errorText = (error: unknown) => error instanceof Error ? error.message : "请求失败，请重试";

export const useGenerationWorkbenchStore = create<State>((set, get) => {
    const patch = (id: string, value: Partial<StudioTask>) => set((state) => ({
        entries: state.entries[id] ? { ...state.entries, [id]: { ...state.entries[id], ...value } } : state.entries,
    }));
    const watch = (id: string) => {
        const entry = get().entries[id];
        if (!entry?.task || isTerminal(entry.task.status) || watchers.has(id)) return;
        const epoch = session;
        const controller = new AbortController();
        watchers.set(id, controller);
        patch(id, { error: undefined });
        void waitForTask(entry.task.id, {
            signal: controller.signal,
            onUpdate: (task) => {
                if (epoch !== session) return;
                const previous = get().entries[id]?.task;
                if (previous && isTerminal(previous.status) && !isTerminal(task.status)) return;
                patch(id, { task });
            },
        }).then((task) => {
            if (epoch !== session) return;
            if (entry.agentTaskId) useWorkbenchAgentStore.getState().updateTask(entry.agentTaskId, {
                status: task.outputs.length ? "succeeded" : "failed",
                successCount: task.outputs.length,
                failCount: Math.max(0, Number(task.params.count ?? 1) - task.outputs.length),
                error: task.error || undefined,
            });
            void useAuthStore.getState().refreshWallet();
        }).catch((error) => {
            if (epoch === session && !controller.signal.aborted) patch(id, { error: `状态同步中断：${errorText(error)}` });
        }).finally(() => { if (watchers.get(id) === controller) watchers.delete(id); });
    };
    const send = async (id: string) => {
        const entry = get().entries[id];
        if (!entry?.input || entry.submitting || entry.task) return;
        const epoch = session;
        patch(id, { submitting: true, error: undefined });
        try {
            // The draft ID is the idempotency key, including manual retries after a lost response.
            const task = await submitGeneration(entry.input, id);
            if (epoch !== session) return;
            set((state) => {
                const entries = { ...state.entries };
                delete entries[id];
                entries[task.id] = { ...entry, id: task.id, task, submitting: false, error: undefined };
                return { entries };
            });
            if (entry.agentTaskId) useWorkbenchAgentStore.getState().updateTask(entry.agentTaskId, { status: "running", error: undefined });
            void useAuthStore.getState().refreshWallet();
            watch(task.id);
        } catch (error) {
            if (epoch !== session) return;
            const uncertain = !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
            patch(id, { submitting: false, error: errorText(error), uncertain });
            if (entry.agentTaskId) useWorkbenchAgentStore.getState().updateTask(entry.agentTaskId, { status: "failed", error: errorText(error) });
        }
    };
    return {
        entries: {},
        submit: async (inputs, agentTaskId) => {
            if (!useAuthStore.getState().user) return;
            const drafts = inputs.map((input) => ({ id: newIdempotencyKey(), createdAt: new Date().toISOString(), input: structuredClone(input), agentTaskId }));
            set((state) => ({ entries: { ...state.entries, ...Object.fromEntries(drafts.map((entry) => [entry.id, entry])) } }));
            await Promise.allSettled(drafts.map((entry) => send(entry.id)));
        },
        retrySubmission: send,
        removeTask: async (id) => {
            await deleteTask(id);
            set((state) => {
                const entries = { ...state.entries };
                delete entries[id];
                return { entries };
            });
        },
        resume: watch,
        ingest: (tasks) => {
            set((state) => {
                const entries = { ...state.entries };
                for (const task of tasks) {
                    const previous = entries[task.id];
                    // A slow history request cannot overwrite a newer terminal polling snapshot.
                    if (previous?.task && isTerminal(previous.task.status) && !isTerminal(task.status)) continue;
                    entries[task.id] = { ...previous, id: task.id, createdAt: task.createdAt, task };
                }
                return { entries };
            });
            tasks.forEach((task) => watch(task.id));
        },
        recover: async (kind) => {
            const epoch = session;
            let page = 1;
            for (;;) {
                const result = await fetchTasks({ page, pageSize: 20, capability: kind, status: "active" });
                if (epoch !== session) return;
                get().ingest(result.items);
                if (page * result.pageSize >= result.total) return;
                page += 1;
            }
        },
    };
});

useAuthStore.subscribe((state, previous) => {
    if (state.user?.id === previous.user?.id) return;
    session += 1;
    watchers.forEach((controller) => controller.abort());
    watchers.clear();
    useGenerationWorkbenchStore.setState({ entries: {} });
});
