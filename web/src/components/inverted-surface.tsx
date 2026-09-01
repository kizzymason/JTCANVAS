import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type InvertedSurfaceProps = HTMLAttributes<HTMLElement> & {
    as?: "article" | "div";
    innerClassName?: string;
};

/**
 * Shared inverted “box” chrome used by canvas library cards and the wallet card:
 * opposite of the site theme, inner highlight, grid grain, and a restrained hover sheen.
 */
export function InvertedSurface({ as: Comp = "div", className, innerClassName, children, ...props }: InvertedSurfaceProps) {
    return (
        <Comp
            className={cn(
                "group relative overflow-hidden text-stone-100 transition-[transform,box-shadow] duration-300 ease-out",
                "bg-[linear-gradient(152deg,#2a2a2a_0%,#141414_46%,#070707_100%)] shadow-[0_16px_36px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.16)]",
                "hover:-translate-y-px hover:shadow-[0_18px_38px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.2)]",
                "dark:bg-[linear-gradient(152deg,#ffffff_0%,#f4f4f2_48%,#e7e5e0_100%)] dark:text-stone-950 dark:shadow-[0_16px_36px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.95)]",
                "dark:hover:shadow-[0_22px_48px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,1)]",
                className,
            )}
            {...props}
        >
            <span aria-hidden className="pointer-events-none absolute inset-px rounded-[inherit] border border-white/10 dark:border-black/10" />
            <span
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-[0.11] mix-blend-overlay dark:opacity-[0.18] dark:mix-blend-multiply"
                style={{
                    backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.16) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px)",
                    backgroundSize: "22px 22px",
                }}
            />
            <span
                aria-hidden
                className="pointer-events-none absolute -left-1/3 top-0 h-full w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-0 transition-all duration-500 group-hover:left-1/2 group-hover:opacity-100 dark:via-black/5"
            />
            <div className={cn("relative z-10 h-full", innerClassName)}>{children}</div>
        </Comp>
    );
}
