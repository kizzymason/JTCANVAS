import { showPageUpdatedPrompt } from "@/components/layout/page-updated-prompt";

function errorText(error: unknown) {
    if (error instanceof Error) return `${error.name} ${error.message}`;
    return String(error ?? "");
}

/** Vite hashed chunks disappear after a deploy; leftover tabs then import HTML or 404s. */
export function isStaleChunkError(error: unknown) {
    const text = errorText(error);
    return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\w.-]+ failed/i.test(text);
}

export function listenForStaleChunks() {
    window.addEventListener("vite:preloadError", (event) => {
        event.preventDefault();
        showPageUpdatedPrompt();
    });
}
