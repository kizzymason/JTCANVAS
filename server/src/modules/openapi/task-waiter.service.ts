import { Inject, Injectable } from "@nestjs/common";
import Redis from "ioredis";
import { REDIS_SUBSCRIBER } from "../../redis/redis.module";
import { GenerationService, type TaskResponse } from "../generation/generation.service";
import { statusChannel, streamChannel } from "../generation/generation.queue";
import { upstreamError } from "./openai-errors";

const TERMINAL_STATUSES = new Set(["succeeded", "partial", "failed", "cancelled"]);
/** Backstop re-read: covers a status publish that landed before we subscribed. */
const RECHECK_INTERVAL_MS = 3_000;

export type TextStreamEvent = { type: "delta"; text: string } | { type: "done"; task: TaskResponse };

/**
 * Turns the platform's asynchronous task pipeline into the synchronous shapes the OpenAI protocol
 * expects. The worker publishes terminal state over Redis pub/sub, which is what lets any API
 * instance serve a caller regardless of which worker picked the job up.
 */
@Injectable()
export class TaskWaiterService {
    constructor(
        @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
        private readonly generation: GenerationService,
    ) {}

    /** Resolves once the task reaches a terminal state, or throws 504-equivalent on timeout. */
    async waitForCompletion(userId: string, taskId: string, timeoutMs: number): Promise<TaskResponse> {
        const connection = this.subscriber.duplicate();
        try {
            await connection.subscribe(statusChannel(taskId));

            // Subscribed first, then read: the reverse order can miss a fast task entirely.
            const current = await this.generation.get(userId, taskId);
            if (TERMINAL_STATUSES.has(current.status)) return current;

            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const settled = await this.raceMessage(connection, Math.min(RECHECK_INTERVAL_MS, deadline - Date.now()));
                const task = await this.generation.get(userId, taskId);
                if (TERMINAL_STATUSES.has(task.status)) return task;
                if (settled) continue;
            }
            throw upstreamError("The generation task did not finish in time. Retrieve it later with the task id.", "timeout");
        } finally {
            await connection.quit().catch(() => undefined);
        }
    }

    /**
     * Relays worker text deltas. Yields every chunk as it arrives and finishes with the settled task,
     * so the caller can emit a final OpenAI chunk carrying real usage numbers.
     */
    async *streamText(userId: string, taskId: string, timeoutMs: number): AsyncGenerator<TextStreamEvent> {
        const connection = this.subscriber.duplicate();
        const deltas = streamChannel(taskId);
        const status = statusChannel(taskId);

        const queue: string[] = [];
        let finished = false;
        let notify: (() => void) | null = null;

        connection.on("message", (channel, message) => {
            if (channel === deltas) queue.push(message);
            else finished = true;
            notify?.();
        });

        try {
            await connection.subscribe(deltas, status);

            const existing = await this.generation.get(userId, taskId);
            if (TERMINAL_STATUSES.has(existing.status)) {
                // Already done: replay the stored text so a late subscriber still gets the answer.
                if (existing.outputText) yield { type: "delta", text: existing.outputText };
                yield { type: "done", task: existing };
                return;
            }

            const deadline = Date.now() + timeoutMs;
            while (!finished && Date.now() < deadline) {
                while (queue.length) yield { type: "delta", text: queue.shift()! };
                if (finished) break;
                await new Promise<void>((resolve) => {
                    notify = resolve;
                    setTimeout(resolve, Math.min(RECHECK_INTERVAL_MS, Math.max(1, deadline - Date.now()))).unref?.();
                });
                notify = null;
                // The publish can be missed if the worker finished before the subscribe landed.
                if (!finished) {
                    const task = await this.generation.get(userId, taskId);
                    if (TERMINAL_STATUSES.has(task.status)) finished = true;
                }
            }
            while (queue.length) yield { type: "delta", text: queue.shift()! };

            const task = await this.generation.get(userId, taskId);
            if (!TERMINAL_STATUSES.has(task.status)) {
                throw upstreamError("The completion did not finish in time.", "timeout");
            }
            yield { type: "done", task };
        } finally {
            await connection.quit().catch(() => undefined);
        }
    }

    /** Resolves true when a status message arrived, false when the wait timed out. */
    private raceMessage(connection: Redis, waitMs: number) {
        if (waitMs <= 0) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
                connection.off("message", onMessage);
                resolve(false);
            }, waitMs);
            timer.unref?.();
            const onMessage = () => {
                clearTimeout(timer);
                connection.off("message", onMessage);
                resolve(true);
            };
            connection.once("message", onMessage);
        });
    }
}
