import { isRouteErrorResponse, useRouteError } from "react-router-dom";

import { PageUpdatedPrompt } from "@/components/layout/page-updated-prompt";
import { isStaleChunkError } from "@/lib/stale-chunk";

export function RouteErrorFallback() {
    const error = useRouteError();
    if (isStaleChunkError(error)) return <PageUpdatedPrompt />;

    const message = isRouteErrorResponse(error) ? error.statusText : error instanceof Error ? error.message : "";

    return (
        <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-background px-6 text-center">
            <p className="text-sm text-muted-foreground">{message || "页面出错"}</p>
            <button type="button" className="text-sm underline underline-offset-4" onClick={() => window.location.reload()}>
                刷新页面
            </button>
        </div>
    );
}
