import { Alert, App, Button, Input, Select, Space, Spin, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { TFunction } from "i18next";
import { Download, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { adminApi, type VisitorEvent, type VisitorKind, type VisitorSummary } from "@/services/api/admin";
import { downloadCsv, fetchAllPages } from "../export-csv";
import { OpsBars, OpsDonut, OpsKpi, OpsLineChart } from "../ops-charts";
import { useAdminTable } from "../use-admin-table";

const KINDS: VisitorKind[] = ["human", "bot", "suspected"];

export default function AdminVisitorsPage() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [summary, setSummary] = useState<VisitorSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [kind, setKind] = useState<VisitorKind | undefined>();
    const [keyword, setKeyword] = useState("");
    const [query, setQuery] = useState("");
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        void adminApi
            .visitorsSummary()
            .then((result) => {
                setSummary(result);
                setLoadError("");
            })
            .catch((error) => setLoadError(error instanceof ApiError ? error.message : t("admin.visitors.loadFailed")))
            .finally(() => setLoading(false));
    }, [t]);

    const table = useAdminTable<VisitorEvent>(
        useCallback((params) => adminApi.visitorEvents({ ...params, kind, keyword: query || undefined }), [kind, query]),
        [kind, query],
    );

    const exportRows = async () => {
        setExporting(true);
        try {
            const items = await fetchAllPages((params) => adminApi.visitorEvents({ ...params, kind, keyword: query || undefined }));
            downloadCsv(
                `visitors-${new Date().toISOString().slice(0, 10)}.csv`,
                [t("admin.visitors.time"), t("admin.visitors.kind"), t("admin.visitors.path"), t("admin.visitors.ip"), t("admin.visitors.device"), t("admin.visitors.userAgent")],
                items.map((item) => [new Date(item.createdAt).toLocaleString(), t(`admin.visitors.kinds.${item.kind}`), item.path, item.ip, item.device, item.userAgent]),
            );
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.visitors.exportFailed"));
        } finally {
            setExporting(false);
        }
    };

    const eventColumns: ColumnsType<VisitorEvent> = [
        { title: t("admin.visitors.time"), dataIndex: "createdAt", width: 170, render: (value: string) => new Date(value).toLocaleString() },
        {
            title: t("admin.visitors.kind"),
            dataIndex: "kind",
            width: 90,
            render: (value: VisitorKind) => <Tag color={kindColor(value)}>{t(`admin.visitors.kinds.${value}`)}</Tag>,
        },
        {
            title: t("admin.visitors.path"),
            dataIndex: "path",
            ellipsis: true,
            render: (value: string) => pageLabel(t, value),
        },
        { title: t("admin.visitors.ip"), dataIndex: "ip", width: 140 },
        { title: t("admin.visitors.device"), dataIndex: "device", width: 180, ellipsis: true },
    ];

    const dates = summary?.days.map((day) => day.date) ?? [];
    const pathBars = useMemo(
        () =>
            (summary?.paths ?? []).map((item) => ({
                label: pageLabel(t, item.path),
                value: item.pv,
                hint: `UV ${item.uv}`,
            })),
        [summary?.paths, t],
    );
    const kindSlices = [
        { label: t("admin.visitors.human"), value: summary?.today.human ?? 0 },
        { label: t("admin.visitors.bot"), value: summary?.today.bot ?? 0 },
        { label: t("admin.visitors.suspected"), value: summary?.today.suspected ?? 0 },
    ];

    return (
        <div className="flex flex-col gap-4 bg-[linear-gradient(to_right,rgba(120,113,108,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(120,113,108,0.08)_1px,transparent_1px)] bg-[size:28px_28px]">
            <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500">{t("admin.visitors.opsLabel")}</p>
                <h1 className="mt-1 text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.visitors.title")}</h1>
                <p className="mt-1 text-sm text-stone-500">{t("admin.visitors.description")}</p>
            </div>

            {loadError ? <Alert type="error" showIcon message={loadError} /> : null}

            {loading ? (
                <div className="flex h-full min-h-[240px] items-center justify-center bg-background">
                    <Spin />
                </div>
            ) : (
                <>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <OpsKpi label={t("admin.visitors.todayPv")} value={String(summary?.today.pv ?? 0)} hint={t("admin.visitors.todayUvHint", { count: summary?.today.uv ?? 0 })} />
                        <OpsKpi label={t("admin.visitors.human")} value={String(summary?.today.human ?? 0)} />
                        <OpsKpi label={t("admin.visitors.bot")} value={String(summary?.today.bot ?? 0)} />
                        <OpsKpi label={t("admin.visitors.suspected")} value={String(summary?.today.suspected ?? 0)} />
                    </div>

                    <div className="grid gap-3 xl:grid-cols-3">
                        <div className="xl:col-span-2">
                            <OpsLineChart
                                title={t("admin.visitors.trafficTrend")}
                                caption={t("admin.visitors.last14Days")}
                                dates={dates}
                                series={[
                                    { id: "pv", label: t("admin.visitors.pv"), values: summary?.days.map((day) => day.pv) ?? [], tone: "primary" },
                                    { id: "uv", label: t("admin.visitors.uv"), values: summary?.days.map((day) => day.uv) ?? [], tone: "muted" },
                                    { id: "human", label: t("admin.visitors.human"), values: summary?.days.map((day) => day.human) ?? [], tone: "faint" },
                                ]}
                            />
                        </div>
                        <OpsDonut title={t("admin.visitors.kindMix")} slices={kindSlices} />
                    </div>

                    <OpsBars title={t("admin.visitors.pathRank")} caption={t("admin.visitors.pathHint")} items={pathBars.length > 0 ? pathBars : [{ label: t("admin.visitors.emptyPages"), value: 0 }]} />
                </>
            )}

            <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">{t("admin.visitors.events")}</h2>
                <Space wrap>
                    <Select
                        allowClear
                        placeholder={t("admin.visitors.allKinds")}
                        className="w-32"
                        value={kind}
                        onChange={(value) => {
                            table.setPage(1);
                            setKind(value);
                        }}
                        options={KINDS.map((item) => ({ value: item, label: t(`admin.visitors.kinds.${item}`) }))}
                    />
                    <Input
                        allowClear
                        className="w-52"
                        placeholder={t("admin.visitors.keywordPlaceholder")}
                        value={keyword}
                        onChange={(event) => setKeyword(event.target.value)}
                        onPressEnter={() => {
                            table.setPage(1);
                            setQuery(keyword.trim());
                        }}
                    />
                    <Button
                        icon={<Search className="size-4" />}
                        onClick={() => {
                            table.setPage(1);
                            setQuery(keyword.trim());
                        }}
                    >
                        {t("admin.visitors.filter")}
                    </Button>
                    <Button icon={<Download className="size-4" />} loading={exporting} onClick={() => void exportRows()}>
                        {t("admin.visitors.export")}
                    </Button>
                </Space>
            </div>
            <Table rowKey="id" size="small" loading={table.loading} dataSource={table.items} columns={eventColumns} pagination={table.pagination} />
        </div>
    );
}

function pageLabel(t: TFunction, path: string) {
    const key = path === "/" ? "home" : path.replace(/^\//, "");
    return t(`admin.visitors.pages.${key}`, { defaultValue: path });
}

function kindColor(kind: VisitorKind) {
    if (kind === "human") return "green";
    if (kind === "bot") return "default";
    return "orange";
}
