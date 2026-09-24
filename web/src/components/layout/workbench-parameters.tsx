import { useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";

/** Shared studio parameter column; mobile keeps the result area within easy reach. */
export function WorkbenchParameters({ children, footer }: { children: ReactNode; footer: ReactNode }) {
    const [expanded, setExpanded] = useState(false);
    return <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card lg:min-h-0">
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-2 p-4 text-left font-medium lg:hidden">
            <SlidersHorizontal size={17} className="text-primary" />创作参数
            <span className="ml-auto text-xs text-muted-foreground">{expanded ? "收起" : "展开设置"}</span>
            <ChevronDown size={16} className={expanded ? "rotate-180" : ""} />
        </button>
        <div className={`${expanded ? "flex" : "hidden"} thin-scrollbar min-w-0 flex-1 flex-col p-4 lg:flex lg:min-h-0 lg:overflow-y-auto`}>{children}</div>
        <div className={`${expanded ? "block" : "hidden"} shrink-0 border-t border-border p-4 lg:block`}>{footer}</div>
    </section>;
}
