import { App, Button, Card, Input, Select, Space, Statistic, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Download, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { adminApi, type VisitorEvent, type VisitorKind, type VisitorSummary } from "@/services/api/admin";
import { downloadCsv, fetchAllPages } from "../export-csv";
import { useAdminTable } from "../use-admin-table";

const KINDS: VisitorKind[] = ["human", "bot", "suspected"];

export default function AdminVisitorsPage() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [summary, setSummary] = useState<VisitorSummary | null>(null);
    const [kind, setKind] = useState<VisitorKind | undefined>();
    const [keyword, setKeyword] = useState("");
    const [query, setQuery] = useState("");
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        void adminApi.visitorsSummary().then(setSummary).catch(() => undefined);
    }, []);

    const table = useAdminTable<VisitorEvent>(
        useCallback((params) => adminApi.visitorEvents({ ...params, kind, keyword: query || undefined }), [kind, query]),
        [kind, query],
    );

    const maxPv = Math.max(1, ...(summary?.days.map((day) => day.pv) ?? [1]));

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
        { title: t("admin.visitors.path"), dataIndex: "path", ellipsis: true },
        { title: t("admin.visitors.ip"), dataIndex: "ip", width: 140 },
        { title: t("admin.visitors.device"), dataIndex: "device", width: 180, ellipsis: true },
    ];

    return (
        <div className="flex flex-col gap-5">
            <div>
                <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.visitors.title")}</h1>
                <p className="mt-1 text-sm text-stone-500">{t("admin.visitors.description")}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Card size="small">
                    <Statistic title={t("admin.visitors.todayPv")} value={summary?.today.pv ?? 0} />
                </Card>
                <Card size="small">
                    <Statistic title={t("admin.visitors.todayUv")} value={summary?.today.uv ?? 0} />
                </Card>
                <Card size="small">
                    <Statistic title={t("admin.visitors.human")} value={summary?.today.human ?? 0} />
                </Card>
                <Card size="small">
                    <Statistic title={t("admin.visitors.bot")} value={summary?.today.bot ?? 0} />
                </Card>
                <Card size="small">
                    <Statistic title={t("admin.visitors.suspected")} value={summary?.today.suspected ?? 0} />
                </Card>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
                <Card size="small" title={t("admin.visitors.last14Days")}>
                    <div className="flex h-28 items-end gap-1">
                        {(summary?.days ?? []).map((day) => (
                            <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                                <div
                                    className="w-full rounded-sm bg-stone-800 dark:bg-stone-200"
                                    style={{ height: `${Math.max(4, (day.pv / maxPv) * 100)}%` }}
                                    title={`${day.date} PV ${day.pv} / UV ${day.uv}`}
                                />
                            </div>
                        ))}
                    </div>
                    <div className="mt-2 flex justify-between text-xs text-stone-500">
                        <span>{summary?.days[0]?.date ?? ""}</span>
                        <span>{summary?.days.at(-1)?.date ?? ""}</span>
                    </div>
                </Card>
                <Card size="small" title={t("admin.visitors.pathRank")}>
                    <Table
                        rowKey="path"
                        size="small"
                        pagination={false}
                        dataSource={summary?.paths ?? []}
                        columns={[
                            { title: t("admin.visitors.path"), dataIndex: "path", ellipsis: true },
                            { title: t("admin.visitors.pv"), dataIndex: "pv", width: 80, align: "right" },
                            { title: t("admin.visitors.uv"), dataIndex: "uv", width: 80, align: "right" },
                        ]}
                    />
                </Card>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 className="text-base font-medium text-stone-950 dark:text-stone-100">{t("admin.visitors.events")}</h2>
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

function kindColor(kind: VisitorKind) {
    if (kind === "human") return "green";
    if (kind === "bot") return "default";
    return "orange";
}
