/** Admin / wallet progress: video quantity is seconds, not clip count. */
export function taskProgressLabel(task: { capability: string; succeededCount: number; quantity: number }) {
    const value = `${task.succeededCount}/${task.quantity}`;
    return task.capability === "video" ? `${value}秒` : value;
}
