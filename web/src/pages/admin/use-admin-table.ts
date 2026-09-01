import { useCallback, useEffect, useState } from "react";

import type { Paginated } from "@/services/api/client";

export const ADMIN_PAGE_SIZE = 20;

/**
 * Shared paging/loading plumbing for the admin tables. Page-private to the admin area per the
 * project conventions, so it lives beside the pages rather than in the global hooks folder.
 */
export function useAdminTable<T>(fetcher: (params: { page: number; pageSize: number }) => Promise<Paginated<T>>, deps: unknown[] = []) {
    const [page, setPage] = useState(1);
    const [items, setItems] = useState<T[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const result = await fetcher({ page, pageSize: ADMIN_PAGE_SIZE });
            setItems(result.items);
            setTotal(result.total);
        } finally {
            setLoading(false);
        }
        // The fetcher closes over caller state, so callers pass their own dependency list.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, ...deps]);

    useEffect(() => {
        void reload();
    }, [reload]);

    return {
        page,
        setPage,
        items,
        total,
        loading,
        reload,
        pagination: { current: page, pageSize: ADMIN_PAGE_SIZE, total, onChange: setPage, showSizeChanger: false as const },
    };
}
