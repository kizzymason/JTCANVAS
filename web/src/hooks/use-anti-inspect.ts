import { useEffect } from "react";

import { installAntiInspect } from "@/lib/anti-inspect";

/**
 * Applies the anti-snooping deterrents while a page is mounted. See `lib/anti-inspect.ts` for what
 * this does and does not protect: it is a speed bump, not a security boundary.
 */
export function useAntiInspect(enabled = true) {
    useEffect(() => {
        if (!enabled) return;
        return installAntiInspect();
    }, [enabled]);
}
