import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";

vi.mock("@/stores/use-auth-store", () => ({ useAuthStore: create(() => ({ user: { id: "owner" }, refreshWallet: vi.fn(async () => undefined) })) }));
vi.mock("@/services/api/generation", async (original) => {
    const actual = await original<typeof import("../src/services/api/generation")>();
    return { ...actual, submitGeneration: vi.fn(), waitForTask: vi.fn(), fetchTasks: vi.fn() };
});

import { useGenerationWorkbenchStore as studio } from "../src/stores/use-generation-workbench-store";
import { useAuthStore } from "../src/stores/use-auth-store";
import { ApiError } from "../src/services/api/client";
import { fetchTasks, submitGeneration, waitForTask, type GenerationTask, type SubmitGenerationInput } from "../src/services/api/generation";
import { estimateLocally, type PublicModel } from "../src/services/api/models";

const input = (prompt: string): SubmitGenerationInput => ({ capability: "image", model: "channel::image", prompt, count: 2, references: ["ref"] });
const task = (id: string, status: GenerationTask["status"] = "running"): GenerationTask => ({ id, status, capability: "image", modelName: "image", model: "channel::image", prompt: id, createdAt: new Date().toISOString(), finishedAt: null, quantity: 2, succeededCount: 0, estimatedCost: "1", actualCost: "0", outputFileIds: [], outputs: [], outputText: "", error: "", params: { count: 2 } });
const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

beforeEach(() => {
    useAuthStore.setState({ user: { id: crypto.randomUUID() } as never });
    vi.clearAllMocks();
    vi.mocked(waitForTask).mockImplementation(() => new Promise(() => undefined));
});

describe("concurrent workbench submissions", () => {
    it("preserves immutable prompt/reference snapshots and independently completes out of order", async () => {
        const first = deferred<GenerationTask>();
        const second = deferred<GenerationTask>();
        vi.mocked(submitGeneration).mockImplementation((request) => request.prompt === "first" ? first.promise : second.promise);
        const update = new Map<string, (value: GenerationTask) => void>();
        vi.mocked(waitForTask).mockImplementation((id, options) => { update.set(id, options!.onUpdate!); return new Promise(() => undefined); });
        const original = input("first");
        const submission = studio.getState().submit([original, input("second")]);
        original.prompt = "changed";
        original.references!.push("changed-ref");
        expect(submitGeneration).toHaveBeenCalledTimes(2);
        expect(vi.mocked(submitGeneration).mock.calls[0][0]).toMatchObject({ prompt: "first", references: ["ref"] });
        expect(vi.mocked(submitGeneration).mock.calls[0][1]).not.toEqual(vi.mocked(submitGeneration).mock.calls[1][1]);
        second.resolve(task("second"));
        first.resolve(task("first"));
        await submission;
        update.get("second")!(task("second", "succeeded"));
        expect(studio.getState().entries.first.task?.status).toBe("running");
        expect(studio.getState().entries.second.task?.status).toBe("succeeded");
    });

    it("reuses the exact idempotency key and payload after a lost submit response", async () => {
        vi.mocked(submitGeneration).mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "offline", 0)).mockResolvedValueOnce(task("accepted"));
        await studio.getState().submit([input("same")]);
        const draft = Object.values(studio.getState().entries)[0];
        expect(draft.uncertain).toBe(true);
        await studio.getState().retrySubmission(draft.id);
        expect(vi.mocked(submitGeneration).mock.calls[0]).toEqual(vi.mocked(submitGeneration).mock.calls[1]);
        expect(Object.keys(studio.getState().entries)).toEqual(["accepted"]);
    });

    it("does not resend while the same submission is in flight", async () => {
        const pending = deferred<GenerationTask>();
        vi.mocked(submitGeneration).mockReturnValue(pending.promise);
        const submitting = studio.getState().submit([input("same")]);
        await studio.getState().retrySubmission(Object.keys(studio.getState().entries)[0]);
        expect(submitGeneration).toHaveBeenCalledTimes(1);
        pending.resolve(task("one"));
        await submitting;
    });

    it("keeps accepted tasks when a sibling is rejected by the server capacity check", async () => {
        vi.mocked(submitGeneration).mockResolvedValueOnce(task("ok")).mockRejectedValueOnce(new ApiError("TOO_MANY_ACTIVE_TASKS", "任务数量超限", 429));
        await studio.getState().submit([input("ok"), input("rejected")]);
        expect(studio.getState().entries.ok.task?.status).toBe("running");
        expect(Object.values(studio.getState().entries).find((entry) => entry.error)?.error).toBe("任务数量超限");
    });

    it("recovers server tasks, deduplicates watchers, and ignores stale history", () => {
        studio.getState().ingest([task("one")]);
        studio.getState().ingest([task("one")]);
        expect(waitForTask).toHaveBeenCalledTimes(1);
        studio.getState().ingest([task("one", "succeeded")]);
        studio.getState().ingest([task("one", "running")]);
        expect(studio.getState().entries.one.task?.status).toBe("succeeded");
    });

    it("does not let late submit responses leak into a different account", async () => {
        const pending = deferred<GenerationTask>();
        vi.mocked(submitGeneration).mockReturnValue(pending.promise);
        const submitting = studio.getState().submit([input("private")]);
        useAuthStore.setState({ user: { id: "another-owner" } as never });
        pending.resolve(task("private"));
        await submitting;
        expect(studio.getState().entries).toEqual({});
        expect(waitForTask).not.toHaveBeenCalled();
    });

    it("a late poll cannot replace an already completed server snapshot", () => {
        let update!: (task: GenerationTask) => void;
        vi.mocked(waitForTask).mockImplementation((_id, options) => { update = options!.onUpdate!; return new Promise(() => undefined); });
        studio.getState().ingest([task("one")]);
        studio.getState().ingest([task("one", "succeeded")]);
        update(task("one", "pending"));
        expect(studio.getState().entries.one.task?.status).toBe("succeeded");
    });

    it("polling errors resume the same server task without a second paid submission", async () => {
        vi.mocked(waitForTask).mockRejectedValueOnce(new Error("offline"));
        studio.getState().ingest([task("one")]);
        await vi.waitFor(() => expect(studio.getState().entries.one.error).toContain("offline"));
        studio.getState().resume("one");
        expect(waitForTask).toHaveBeenCalledTimes(2);
        expect(submitGeneration).not.toHaveBeenCalled();
        expect(studio.getState().entries.one.task?.status).toBe("running");
    });

    it("loads every page of active tasks without resubmitting paid requests", async () => {
        vi.mocked(fetchTasks).mockResolvedValueOnce({ items: [task("one")], total: 21, page: 1, pageSize: 20 }).mockResolvedValueOnce({ items: [task("two")], total: 21, page: 2, pageSize: 20 });
        await studio.getState().recover("image");
        expect(Object.keys(studio.getState().entries)).toEqual(["one", "two"]);
        expect(submitGeneration).not.toHaveBeenCalled();
        expect(vi.mocked(fetchTasks).mock.calls[1][0]).toMatchObject({ page: 2, status: "active", capability: "image" });
    });
});

describe("batch price estimates", () => {
    const model = { billingMode: "per_image", unitPrice: "0.1", extraReferencePrice: "0.2", minCharge: "0.5", specPrices: {} } as PublicModel;
    it("applies the minimum independently to each paid task", () => {
        expect(estimateLocally(model, { count: 1, taskCount: 3 })).toBe("1.50");
    });
    it("charges each task's extra references, including image batches", () => {
        expect(estimateLocally(model, { count: 4, referenceCount: 3, taskCount: 3 })).toBe("2.40");
    });
    it("retains video seconds per task", () => {
        expect(estimateLocally({ ...model, billingMode: "per_second" }, { seconds: 12, taskCount: 3 })).toBe("3.60");
    });
    it("does not crash on an incomplete video duration during editing", () => {
        expect(estimateLocally({ ...model, billingMode: "per_second" }, { taskCount: 3 })).toBe("");
    });
});

