import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

const SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.72 } as const;

type SegmentedSwitchItem<T extends string> = {
    value: T;
    label: string;
};

type SegmentedSwitchProps<T extends string> = {
    value: T;
    items: SegmentedSwitchItem<T>[];
    onChange: (value: T) => void;
    className?: string;
};

/**
 * Two-stop rectangular switch. The thumb is inset from the track on every side so it never sits
 * flush against the grey well, and it travels with a spring instead of a linear snap.
 */
export function SegmentedSwitch<T extends string>({ value, items, onChange, className }: SegmentedSwitchProps<T>) {
    const reduceMotion = useReducedMotion();
    const index = Math.max(0, items.findIndex((item) => item.value === value));

    return (
        <div className={cn("relative grid grid-cols-2 rounded-md bg-secondary p-1.5", className)}>
            <motion.span
                aria-hidden
                className="absolute top-1.5 bottom-1.5 left-1.5 w-[calc(50%-0.375rem)] rounded-sm bg-accent"
                initial={false}
                animate={{ x: index === 0 ? 0 : "100%" }}
                transition={reduceMotion ? { duration: 0 } : SPRING}
            />
            {items.map((item) => {
                const active = item.value === value;
                return (
                    <button
                        key={item.value}
                        type="button"
                        onClick={() => onChange(item.value)}
                        className={cn(
                            "relative z-10 rounded-sm py-1.5 text-sm transition-colors duration-300",
                            active ? "font-medium text-primary" : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
}
