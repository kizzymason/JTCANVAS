import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type InvertedSurfaceProps = HTMLAttributes<HTMLElement> & {
    as?: "article" | "div";
    innerClassName?: string;
};

/** Shared brand surface for personal projects and the account balance. */
export function InvertedSurface({ as: Comp = "div", className, innerClassName, children, ...props }: InvertedSurfaceProps) {
    return (
        <Comp
            className={cn(
                "group relative overflow-hidden border border-border bg-card text-foreground transition-colors duration-200 hover:border-primary/40",
                className,
            )}
            {...props}
        >
            <div className={cn("relative z-10 h-full", innerClassName)}>{children}</div>
        </Comp>
    );
}
