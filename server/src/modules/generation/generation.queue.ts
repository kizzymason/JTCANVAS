export const GENERATION_QUEUE = "generation";

export type GenerationJobData = {
    taskId: string;
    userId: string;
};

/** Redis channel used to relay streaming text from the worker to whichever API instance holds the client. */
export function streamChannel(taskId: string) {
    return `generation:stream:${taskId}`;
}

/** Redis channel for terminal task state, so an API instance can close an SSE connection promptly. */
export function statusChannel(taskId: string) {
    return `generation:status:${taskId}`;
}
