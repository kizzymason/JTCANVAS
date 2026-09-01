import { saveAs } from "file-saver";

import type { Paginated } from "@/services/api/client";

/** Matches the existing `PaginationDto` maximum; export walks pages rather than raising the cap. */
const EXPORT_PAGE_SIZE = 200;

export function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
    const escape = (value: string | number | null | undefined) => {
        const text = value == null ? "" : String(value);
        if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
        return text;
    };
    const body = [headers.map(escape), ...rows.map((row) => row.map(escape))].map((row) => row.join(",")).join("\n");
    saveAs(new Blob([`\uFEFF${body}`], { type: "text/csv;charset=utf-8" }), filename);
}

export async function fetchAllPages<T>(fetcher: (params: { page: number; pageSize: number }) => Promise<Paginated<T>>) {
    const items: T[] = [];
    let page = 1;
    for (;;) {
        const result = await fetcher({ page, pageSize: EXPORT_PAGE_SIZE });
        items.push(...result.items);
        if (items.length >= result.total || !result.items.length) break;
        page += 1;
    }
    return items;
}
