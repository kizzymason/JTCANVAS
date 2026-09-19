import { useRef, useState, type PointerEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ChartSeries = {
    id: string;
    label: string;
    values: number[];
    tone?: "primary" | "muted" | "faint";
};

const SLICE_FILL = [
    "fill-stone-950 dark:fill-zinc-50",
    "fill-amber-500 dark:fill-amber-400",
    "fill-teal-600 dark:fill-teal-300",
    "fill-rose-600 dark:fill-rose-400",
    "fill-sky-700 dark:fill-sky-400",
    "fill-lime-600 dark:fill-lime-400",
];

const SLICE_SWATCH = [
    "bg-stone-950 dark:bg-zinc-50",
    "bg-amber-500 dark:bg-amber-400",
    "bg-teal-600 dark:bg-teal-300",
    "bg-rose-600 dark:bg-rose-400",
    "bg-sky-700 dark:bg-sky-400",
    "bg-lime-600 dark:bg-lime-400",
];

type OpsPanelProps = {
    title: string;
    caption?: string;
    extra?: ReactNode;
    className?: string;
    children: ReactNode;
};

function Corner({ className }: { className: string }) {
    return <span aria-hidden className={cn("pointer-events-none absolute h-2.5 w-2.5 border-stone-800 dark:border-stone-200", className)} />;
}

export function OpsPanel({ title, caption, extra, className, children }: OpsPanelProps) {
    return (
        <section className={cn("relative border border-stone-300 bg-background/85 p-4 dark:border-stone-700", className)}>
            <Corner className="left-0 top-0 border-l border-t" />
            <Corner className="right-0 top-0 border-r border-t" />
            <Corner className="bottom-0 left-0 border-b border-l" />
            <Corner className="bottom-0 right-0 border-b border-r" />
            <div className="mb-3 flex items-end justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">{title}</h2>
                    {caption ? <p className="mt-1 text-xs text-stone-500">{caption}</p> : null}
                </div>
                {extra ? <div className="shrink-0 text-xs tabular-nums text-stone-500">{extra}</div> : null}
            </div>
            {children}
        </section>
    );
}

export function OpsKpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="relative min-w-0 border border-stone-300 bg-background/85 px-4 py-3 dark:border-stone-700">
            <Corner className="left-0 top-0 border-l border-t" />
            <Corner className="right-0 top-0 border-r border-t" />
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-500">{label}</div>
            <div className="mt-2 truncate text-3xl font-semibold tabular-nums tracking-tight text-stone-950 dark:text-stone-100">{value}</div>
            {hint ? <div className="mt-1 truncate text-xs text-stone-500">{hint}</div> : null}
        </div>
    );
}

function seriesStroke(tone: ChartSeries["tone"]) {
    if (tone === "muted") return "stroke-amber-600 dark:stroke-amber-400";
    if (tone === "faint") return "stroke-rose-600 dark:stroke-rose-400";
    return "stroke-stone-950 dark:stroke-zinc-50";
}

function seriesFill(tone: ChartSeries["tone"]) {
    if (tone === "muted") return "fill-amber-600 dark:fill-amber-400";
    if (tone === "faint") return "fill-rose-600 dark:fill-rose-400";
    return "fill-stone-950 dark:fill-zinc-50";
}

function seriesSwatch(tone: ChartSeries["tone"]) {
    if (tone === "muted") return "bg-amber-600 dark:bg-amber-400";
    if (tone === "faint") return "bg-rose-600 dark:bg-rose-400";
    return "bg-stone-950 dark:bg-zinc-50";
}

function defaultFormatValue(value: number) {
    if (Number.isInteger(value) || Math.abs(value - Math.round(value)) < 1e-6) return String(Math.round(value));
    return value.toFixed(2);
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const mapped = point.matrixTransform(ctm.inverse());
    return { x: mapped.x, y: mapped.y };
}

function svgToCss(svg: SVGSVGElement, root: DOMRect, x: number, y: number) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const point = svg.createSVGPoint();
    point.x = x;
    point.y = y;
    const mapped = point.matrixTransform(ctm);
    return { cssX: mapped.x - root.left, cssY: mapped.y - root.top };
}

function snapSeriesValue(series: ChartSeries[], index: number, target: number, focusId: string | null) {
    const focused = focusId ? series.filter((item) => item.id === focusId) : series;
    const pool = focused.length > 0 ? focused : series;
    let best: number | null = null;
    for (const item of pool) {
        const value = item.values[index];
        if (value === undefined) continue;
        if (best === null || Math.abs(value - target) < Math.abs(best - target)) best = value;
    }
    return best;
}

function polar(cx: number, cy: number, radius: number, angle: number) {
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)] as const;
}

function donutSlicePath(cx: number, cy: number, outer: number, inner: number, start: number, end: number) {
    const large = end - start > Math.PI ? 1 : 0;
    const [x1, y1] = polar(cx, cy, outer, start);
    const [x2, y2] = polar(cx, cy, outer, end);
    const [x3, y3] = polar(cx, cy, inner, end);
    const [x4, y4] = polar(cx, cy, inner, start);
    return `M ${x1} ${y1} A ${outer} ${outer} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`;
}

type LineHover = {
    index: number;
    svgX: number;
    svgY: number;
    value: number;
    cssX: number;
    cssY: number;
    boxW: number;
};

export function OpsLineChart({
    title,
    caption,
    dates,
    series,
    unit,
    formatValue = defaultFormatValue,
}: {
    title: string;
    caption?: string;
    dates: string[];
    series: ChartSeries[];
    unit?: string;
    formatValue?: (value: number) => string;
}) {
    const width = 720;
    const height = 228;
    const pad = { top: 16, right: 16, bottom: 36, left: 52 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const max = Math.max(1, ...series.flatMap((item) => item.values));
    const lastIndex = Math.max(0, dates.length - 1);
    const xAt = (index: number) => pad.left + (lastIndex === 0 ? innerW / 2 : (index / lastIndex) * innerW);
    const yAt = (value: number) => pad.top + innerH - (value / max) * innerH;
    const yValueAt = (svgY: number) => ((pad.top + innerH - svgY) / innerH) * max;
    const ticks = [0, max / 2, max];
    const rootRef = useRef<HTMLDivElement>(null);
    const [hover, setHover] = useState<LineHover | null>(null);
    const [focusId, setFocusId] = useState<string | null>(null);

    const onMove = (event: PointerEvent<SVGSVGElement>) => {
        if (dates.length === 0) return;
        const svg = event.currentTarget;
        const svgPoint = clientToSvg(svg, event.clientX, event.clientY);
        const root = rootRef.current?.getBoundingClientRect();
        if (!svgPoint || !root) return;
        const plotX = clamp(svgPoint.x, pad.left, pad.left + innerW);
        const plotY = clamp(svgPoint.y, pad.top, pad.top + innerH);
        const ratio = lastIndex === 0 ? 0 : (plotX - pad.left) / innerW;
        const index = clamp(Math.round(ratio * lastIndex), 0, lastIndex);
        const value = snapSeriesValue(series, index, yValueAt(plotY), focusId) ?? yValueAt(plotY);
        const svgX = xAt(index);
        const svgY = yAt(value);
        const css = svgToCss(svg, root, svgX, svgY);
        if (!css) return;
        setHover({
            index,
            svgX,
            svgY,
            value,
            cssX: css.cssX,
            cssY: css.cssY,
            boxW: root.width,
        });
    };

    const tooltipLeft = hover ? (hover.cssX > hover.boxW * 0.55 ? hover.cssX - 12 : hover.cssX + 12) : 0;
    const tooltipSide = hover && hover.cssX > hover.boxW * 0.55 ? "right" : "left";

    return (
        <OpsPanel title={title} caption={caption} extra={unit}>
            <div ref={rootRef} className="relative">
                <svg
                    viewBox={`0 0 ${width} ${height}`}
                    preserveAspectRatio="none"
                    className="block w-full cursor-crosshair text-stone-900 dark:text-stone-100"
                    style={{ aspectRatio: `${width} / ${height}` }}
                    role="img"
                    aria-label={title}
                    onPointerMove={onMove}
                    onPointerLeave={() => setHover(null)}
                >
                    {ticks.map((tick, index) => {
                        const py = yAt(tick);
                        return (
                            <g key={`${tick}-${index}`}>
                                <line x1={pad.left} x2={width - pad.right} y1={py} y2={py} className="stroke-stone-200 dark:stroke-stone-800" strokeWidth="1" />
                                <text x={pad.left - 8} y={py + 4} textAnchor="end" className="fill-stone-400" fontSize="10">
                                    {formatValue(tick)}
                                </text>
                            </g>
                        );
                    })}
                    {series.map((item) => {
                        if (item.values.length === 0) return null;
                        const points = item.values.map((value, index) => `${xAt(index)},${yAt(value)}`).join(" ");
                        const area = `${xAt(0)},${yAt(0)} ${points} ${xAt(item.values.length - 1)},${yAt(0)}`;
                        const dimmed = focusId !== null && focusId !== item.id;
                        return (
                            <g key={item.id} className={dimmed ? "opacity-25" : "opacity-100"}>
                                {item.tone === "primary" ? <polygon points={area} className="fill-stone-900/10 dark:fill-stone-100/10" /> : null}
                                <polyline points={points} fill="none" className={seriesStroke(item.tone)} strokeWidth={item.tone === "primary" ? 2.25 : 1.75} strokeLinejoin="round" strokeLinecap="round" />
                            </g>
                        );
                    })}
                    {hover ? (
                        <g pointerEvents="none">
                            <line x1={hover.svgX} x2={hover.svgX} y1={pad.top} y2={pad.top + innerH} className="stroke-stone-800 dark:stroke-stone-200" strokeWidth="1" strokeDasharray="3 3" />
                            <line x1={pad.left} x2={width - pad.right} y1={hover.svgY} y2={hover.svgY} className="stroke-stone-800 dark:stroke-stone-200" strokeWidth="1" strokeDasharray="3 3" />
                            <rect x={2} y={hover.svgY - 9} width={pad.left - 6} height={18} className="fill-stone-950 dark:fill-zinc-50" />
                            <text x={pad.left - 8} y={hover.svgY + 4} textAnchor="end" className="fill-zinc-50 dark:fill-stone-950" fontSize="10">
                                {formatValue(hover.value)}
                            </text>
                            <rect x={clamp(hover.svgX - 28, pad.left, width - pad.right - 56)} y={height - 22} width={56} height={16} className="fill-stone-950 dark:fill-zinc-50" />
                            <text x={clamp(hover.svgX, pad.left + 28, width - pad.right - 28)} y={height - 11} textAnchor="middle" className="fill-zinc-50 dark:fill-stone-950" fontSize="10">
                                {formatDay(dates[hover.index] ?? "")}
                            </text>
                            {series.map((item) => {
                                const value = item.values[hover.index];
                                if (value === undefined) return null;
                                return (
                                    <g key={`${item.id}-dot`}>
                                        <circle cx={hover.svgX} cy={yAt(value)} r="5" className="fill-background" />
                                        <circle cx={hover.svgX} cy={yAt(value)} r="3.5" className={seriesFill(item.tone)} />
                                    </g>
                                );
                            })}
                        </g>
                    ) : (
                        [dates[0], dates[Math.floor(dates.length / 2)], dates.at(-1)].filter(Boolean).map((label, index) => (
                            <text key={`${label}-${index}`} x={index === 0 ? pad.left : index === 1 ? width / 2 : width - pad.right} y={height - 8} textAnchor={index === 0 ? "start" : index === 1 ? "middle" : "end"} className="fill-stone-400" fontSize="10">
                                {formatDay(label as string)}
                            </text>
                        ))
                    )}
                    <rect x={0} y={0} width={width} height={height} fill="none" pointerEvents="all" />
                </svg>
                {hover && dates[hover.index] ? (
                    <div
                        className="pointer-events-none absolute z-10 min-w-[168px] border border-stone-800 bg-background px-3 py-2 text-xs shadow-sm dark:border-stone-200"
                        style={{
                            top: Math.max(8, hover.cssY - 12),
                            left: tooltipSide === "left" ? tooltipLeft : undefined,
                            right: tooltipSide === "right" ? hover.boxW - tooltipLeft : undefined,
                        }}
                    >
                        <div className="mb-1.5 font-mono tabular-nums text-stone-950 dark:text-stone-100">{dates[hover.index]}</div>
                        <ul className="space-y-1">
                            {series.map((item) => (
                                <li key={item.id} className="flex items-center justify-between gap-4">
                                    <span className="inline-flex items-center gap-2 text-stone-600 dark:text-stone-300">
                                        <span className={cn("h-2 w-2 rounded-full", seriesSwatch(item.tone))} />
                                        {item.label}
                                    </span>
                                    <span className="font-mono tabular-nums text-stone-950 dark:text-stone-100">{formatValue(item.values[hover.index] ?? 0)}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-[11px] uppercase tracking-[0.16em] text-stone-500">
                {series.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        className={cn("inline-flex items-center gap-2 hover:text-stone-950 dark:hover:text-stone-100", focusId && focusId !== item.id ? "opacity-40" : "opacity-100")}
                        onMouseEnter={() => setFocusId(item.id)}
                        onMouseLeave={() => setFocusId(null)}
                        onFocus={() => setFocusId(item.id)}
                        onBlur={() => setFocusId(null)}
                    >
                        <span className={cn("h-px w-5", seriesSwatch(item.tone))} />
                        {item.label}
                    </button>
                ))}
            </div>
        </OpsPanel>
    );
}

export function OpsDonut({ title, caption, slices }: { title: string; caption?: string; slices: Array<{ label: string; value: number }> }) {
    const total = slices.reduce((sum, item) => sum + Math.max(0, item.value), 0);
    const cx = 70;
    const cy = 70;
    const outer = 58;
    const inner = 38;
    const [active, setActive] = useState<number | null>(null);
    let angle = -Math.PI / 2;
    const gap = slices.filter((item) => item.value > 0).length > 1 ? 0.06 : 0;
    const paths = slices.map((slice, index) => {
        const value = Math.max(0, slice.value);
        const span = total > 0 ? (value / total) * Math.PI * 2 : 0;
        const start = angle;
        const end = angle + Math.max(0, span - gap);
        angle += span;
        return { ...slice, index, start, end, value, percent: total > 0 ? (value / total) * 100 : 0 };
    });
    const activeSlice = active !== null ? paths[active] : null;

    return (
        <OpsPanel title={title} caption={caption} extra={String(total)}>
            <div className="flex items-center gap-5">
                <svg viewBox="0 0 140 140" className="size-36 shrink-0" role="img" aria-label={title}>
                    <circle cx={cx} cy={cy} r={(outer + inner) / 2} fill="none" className="stroke-stone-200 dark:stroke-stone-800" strokeWidth={outer - inner} />
                    {paths.map((slice) => {
                        if (slice.value <= 0 || slice.end <= slice.start) return null;
                        const hovered = active === slice.index;
                        const dimmed = active !== null && !hovered;
                        return (
                            <path
                                key={slice.label}
                                d={donutSlicePath(cx, cy, hovered ? outer + 2 : outer, hovered ? inner - 2 : inner, slice.start, slice.end)}
                                className={cn(SLICE_FILL[slice.index % SLICE_FILL.length], dimmed ? "opacity-35" : "opacity-100", "cursor-pointer transition-opacity")}
                                onPointerEnter={() => setActive(slice.index)}
                                onPointerLeave={() => setActive(null)}
                            />
                        );
                    })}
                    <text x={cx} y={activeSlice ? 66 : 74} textAnchor="middle" className="fill-stone-950 dark:fill-stone-100" fontSize={activeSlice ? 16 : 18} fontWeight="600">
                        {activeSlice ? activeSlice.value : total}
                    </text>
                    {activeSlice ? (
                        <text x={cx} y={84} textAnchor="middle" className="fill-stone-500" fontSize="9">
                            {`${activeSlice.percent.toFixed(1)}%`}
                        </text>
                    ) : null}
                </svg>
                <ul className="min-w-0 flex-1 space-y-2 text-sm">
                    {paths.map((slice) => (
                        <li key={slice.label}>
                            <button
                                type="button"
                                className={cn("flex w-full items-center justify-between gap-3 text-left", active !== null && active !== slice.index ? "opacity-40" : "opacity-100")}
                                onMouseEnter={() => setActive(slice.index)}
                                onMouseLeave={() => setActive(null)}
                                onFocus={() => setActive(slice.index)}
                                onBlur={() => setActive(null)}
                            >
                                <span className="inline-flex min-w-0 items-center gap-2 truncate text-stone-600 dark:text-stone-300">
                                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", SLICE_SWATCH[slice.index % SLICE_SWATCH.length])} />
                                    <span className="truncate">{slice.label}</span>
                                </span>
                                <span className="shrink-0 tabular-nums text-stone-950 dark:text-stone-100">
                                    {slice.value}
                                    <span className="ml-2 text-[11px] text-stone-500">{slice.percent.toFixed(1)}%</span>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        </OpsPanel>
    );
}

export function OpsBars({ title, caption, items, unit }: { title: string; caption?: string; items: Array<{ label: string; value: number; hint?: string }>; unit?: string }) {
    const max = Math.max(1, ...items.map((item) => item.value));
    return (
        <OpsPanel title={title} caption={caption} extra={unit}>
            <div className="space-y-3">
                {items.map((item) => (
                    <div key={item.label}>
                        <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                            <span className="truncate text-stone-600 dark:text-stone-300">{item.label}</span>
                            <span className="tabular-nums text-stone-950 dark:text-stone-100">
                                {item.value}
                                {item.hint ? <span className="ml-2 text-xs text-stone-500">{item.hint}</span> : null}
                            </span>
                        </div>
                        <div className="h-2 bg-stone-200 dark:bg-stone-800">
                            <div className="h-full bg-stone-900 dark:bg-stone-100" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
                        </div>
                    </div>
                ))}
            </div>
        </OpsPanel>
    );
}

export function formatDay(date: string) {
    return date.slice(5);
}
