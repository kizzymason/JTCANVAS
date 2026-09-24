export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#ffffff",
            dot: "rgba(55,65,81,.22)",
            line: "rgba(55,65,81,.11)",
            selectionStroke: "#111111",
            selectionFill: "rgba(17,17,17,.06)",
        },
        node: {
            label: "#4b5563",
            fill: "#f3f4f6",
            panel: "#ffffff",
            stroke: "#e5e7eb",
            activeStroke: "#111111",
            placeholder: "#9ca3af",
            text: "#171717",
            muted: "#6b7280",
            faint: "#9ca3af",
        },
        toolbar: {
            panel: "rgba(255,255,255,.96)",
            border: "#e5e7eb",
            item: "#4b5563",
            itemHover: "#f3f4f6",
            activeBg: "#111111",
            activeText: "#ffffff",
        },
    },
    dark: {
        canvas: {
            background: "#090b0d",
            dot: "rgba(150,159,166,.14)",
            line: "rgba(245,245,244,.10)",
            selectionStroke: "#c3fa55",
            selectionFill: "rgba(245,247,250,.06)",
        },
        node: {
            label: "#a6afb6",
            fill: "#14171a",
            panel: "#14171a",
            stroke: "#2c3136",
            activeStroke: "#c3fa55",
            placeholder: "#969fa6",
            text: "#f5f7fa",
            muted: "#a6afb6",
            faint: "#7d8992",
        },
        toolbar: {
            panel: "rgba(20,23,26,.96)",
            border: "#2c3136",
            item: "#a6afb6",
            itemHover: "#202428",
            activeBg: "#24282c",
            activeText: "#c3fa55",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
