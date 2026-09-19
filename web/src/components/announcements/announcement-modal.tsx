import { Empty, Modal, Spin } from "antd";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { announcementsApi, type AnnouncementDetail, type AnnouncementSummary } from "@/services/api/announcements";
import { useAnnouncementStore } from "@/stores/use-announcement-store";

export function AnnouncementModal() {
    const { t } = useTranslation();
    const view = useAnnouncementStore((state) => state.view);
    const openDetail = useAnnouncementStore((state) => state.openDetail);
    const backToList = useAnnouncementStore((state) => state.backToList);
    const close = useAnnouncementStore((state) => state.close);
    const open = view.kind !== "closed";
    const showingDetail = view.kind === "detail";

    return (
        <Modal
            open={open}
            onCancel={close}
            footer={null}
            width={showingDetail ? 720 : 560}
            destroyOnHidden
            title={showingDetail && view.fromList ? (
                <button type="button" className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-700 hover:text-stone-950 dark:text-stone-200 dark:hover:text-white" onClick={backToList}>
                    <ArrowLeft className="size-4" />
                    {t("announcements.backToList")}
                </button>
            ) : showingDetail ? (
                t("announcements.detailTitle")
            ) : (
                t("announcements.listTitle")
            )}
        >
            {view.kind === "list" ? <AnnouncementList onOpen={(item) => openDetail(item.id, true)} /> : null}
            {view.kind === "detail" ? <AnnouncementDetailView idOrSlug={view.idOrSlug} /> : null}
        </Modal>
    );
}

function AnnouncementList({ onOpen }: { onOpen: (item: AnnouncementSummary) => void }) {
    const { t } = useTranslation();
    const [items, setItems] = useState<AnnouncementSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError("");
        void announcementsApi
            .list()
            .then((result) => {
                if (!cancelled) setItems(result.items);
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof ApiError ? err.message : t("announcements.loadFailed"));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [t]);

    if (loading) {
        return (
            <div className="flex min-h-40 items-center justify-center">
                <Spin />
            </div>
        );
    }
    if (error) {
        return <p className="py-8 text-center text-sm text-stone-500">{error}</p>;
    }
    if (!items.length) {
        return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("announcements.empty")} />;
    }

    return (
        <ul className="max-h-[70vh] divide-y divide-stone-200 overflow-y-auto dark:divide-stone-800">
            {items.map((item) => (
                <li key={item.id}>
                    <button type="button" className="flex w-full flex-col gap-1 px-1 py-3 text-left transition hover:bg-stone-50 dark:hover:bg-white/5" onClick={() => onOpen(item)}>
                        <span className="text-sm font-medium text-stone-950 dark:text-stone-100">
                            {item.pinned ? <span className="mr-2 rounded bg-stone-900 px-1.5 py-0.5 text-[10px] font-semibold text-white dark:bg-stone-100 dark:text-stone-900">{t("announcements.pinned")}</span> : null}
                            {item.title}
                        </span>
                        <span className="text-xs text-stone-500">{new Date(item.publishedAt).toLocaleString()}</span>
                    </button>
                </li>
            ))}
        </ul>
    );
}

function AnnouncementDetailView({ idOrSlug }: { idOrSlug: string }) {
    const { t } = useTranslation();
    const [item, setItem] = useState<AnnouncementDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError("");
        setItem(null);
        void announcementsApi
            .detail(idOrSlug)
            .then((result) => {
                if (!cancelled) setItem(result);
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof ApiError ? err.message : t("announcements.loadFailed"));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [idOrSlug, t]);

    if (loading) {
        return (
            <div className="flex min-h-48 items-center justify-center">
                <Spin />
            </div>
        );
    }
    if (error || !item) {
        return (
            <div className="py-8 text-center">
                <p className="text-sm text-stone-500">{error || t("announcements.missing")}</p>
            </div>
        );
    }

    return (
        <article className="max-h-[70vh] overflow-y-auto pr-1">
            <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-100">{item.title}</h2>
            <p className="mt-1 text-xs text-stone-500">{new Date(item.publishedAt).toLocaleString()}</p>
            <div className="announcement-html mt-4" dangerouslySetInnerHTML={{ __html: item.content }} />
        </article>
    );
}
