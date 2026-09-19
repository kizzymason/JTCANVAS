import { App, Button, DatePicker, Select, Space, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import { Download, Filter } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { formatMoney } from "@/services/api/models";
import { resellerApi, type ApiLogEntry, type ApiTokenOption, type ResellerModel } from "@/services/api/reseller";
import { downloadCsv, fetchAllPages } from "@/pages/admin/export-csv";
import { useAdminTable } from "@/pages/admin/use-admin-table";

type Filters = {
    range: [Dayjs, Dayjs] | null;
    model?: string;
    apiKeyId?: string;
    status?: "success" | "failed";
};

export default function OpenConsoleLogsPage() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [filterOpen, setFilterOpen] = useState(false);
    const [draft, setDraft] = useState<Filters>({ range: null });
    const [applied, setApplied] = useState<Filters>({ range: null });
    const [tokens, setTokens] = useState<ApiTokenOption[]>([]);
    const [models, setModels] = useState<ResellerModel[]>([]);
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        void resellerApi
            .tokenOptions()
            .then((result) => setTokens(result.items))
            .catch(() => undefined);
        void resellerApi
            .models()
            .then((result) => setModels(result.models))
            .catch(() => undefined);
    }, []);

    const queryParams = useCallback(
        (params: { page: number; pageSize: number }) =>
            resellerApi.logs({
                ...params,
                from: applied.range?.[0]?.startOf("day").toISOString(),
                to: applied.range?.[1]?.endOf("day").toISOString(),
                model: applied.model,
                apiKeyId: applied.apiKeyId,
                status: applied.status,
            }),
        [applied],
    );

    const table = useAdminTable<ApiLogEntry>(queryParams, [applied]);

    const apply = () => {
        table.setPage(1);
        setApplied(draft);
    };

    const reset = () => {
        const cleared: Filters = { range: null };
        setDraft(cleared);
        setApplied(cleared);
        table.setPage(1);
    };

    const exportCsv = async () => {
        setExporting(true);
        try {
            const rows = await fetchAllPages<ApiLogEntry>((params) => queryParams(params));
            downloadCsv(
                `open-platform-logs-${new Date().toISOString().slice(0, 10)}.csv`,
                [
                    t("openPlatform.logs.time"),
                    t("openPlatform.logs.endpoint"),
                    t("openPlatform.logs.model"),
                    t("openPlatform.logs.token"),
                    t("openPlatform.logs.status"),
                    t("openPlatform.logs.inputTokens"),
                    t("openPlatform.logs.outputTokens"),
                    t("openPlatform.logs.amount"),
                    t("openPlatform.logs.latency"),
                    t("openPlatform.logs.errorCode"),
                ],
                rows.map((row) => [new Date(row.createdAt).toISOString(), row.endpoint, row.model, row.apiKeyName ?? "", row.status, row.inputTokens, row.outputTokens, formatMoney(row.billedAmount), row.latencyMs, row.errorCode]),
            );
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("openPlatform.logs.exportFailed"));
        } finally {
            setExporting(false);
        }
    };

    const columns: ColumnsType<ApiLogEntry> = [
        { title: t("openPlatform.logs.time"), dataIndex: "createdAt", width: 170, render: (value: string) => new Date(value).toLocaleString() },
        { title: t("openPlatform.logs.endpoint"), dataIndex: "endpoint", width: 190, ellipsis: true, render: (value: string) => <span className="font-mono text-xs">{value}</span> },
        { title: t("openPlatform.logs.model"), dataIndex: "model", ellipsis: true, render: (value: string) => <span className="font-mono text-xs">{value}</span> },
        { title: t("openPlatform.logs.token"), dataIndex: "apiKeyName", width: 140, ellipsis: true, render: (value: string | null) => value ?? "-" },
        {
            title: t("openPlatform.logs.status"),
            dataIndex: "status",
            width: 110,
            render: (value: string, row) =>
                value === "success" ? (
                    <Tag color="green">{t("openPlatform.logs.statuses.success")}</Tag>
                ) : (
                    <Tooltip title={row.errorCode || undefined}>
                        <Tag color="red">{row.httpStatus || t("openPlatform.logs.statuses.failed")}</Tag>
                    </Tooltip>
                ),
        },
        { title: t("openPlatform.logs.inputTokens"), dataIndex: "inputTokens", width: 100, align: "right" },
        { title: t("openPlatform.logs.outputTokens"), dataIndex: "outputTokens", width: 100, align: "right" },
        {
            title: t("openPlatform.logs.amount"),
            dataIndex: "billedAmount",
            width: 110,
            align: "right",
            render: (value: string) => <span className="tabular-nums">{`¥${formatMoney(value)}`}</span>,
        },
        { title: t("openPlatform.logs.latency"), dataIndex: "latencyMs", width: 100, align: "right", render: (value: number) => `${value} ms` },
        { title: t("openPlatform.logs.clientIp"), dataIndex: "clientIp", width: 130, ellipsis: true, render: (value: string) => value || "-" },
    ];

    const hasFilters = Boolean(applied.range || applied.model || applied.apiKeyId || applied.status);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("openPlatform.logs.title")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{t("openPlatform.logs.description")}</p>
                </div>
                <Space wrap>
                    <Button icon={<Filter className="size-4" />} type={filterOpen || hasFilters ? "primary" : "default"} onClick={() => setFilterOpen((open) => !open)}>
                        {t("common.filter")}
                    </Button>
                    <Button icon={<Download className="size-4" />} loading={exporting} onClick={() => void exportCsv()}>
                        {t("openPlatform.logs.export")}
                    </Button>
                </Space>
            </div>

            {filterOpen ? (
                <div className="flex flex-wrap items-center gap-2 border border-stone-200 p-3 dark:border-stone-800">
                    <DatePicker.RangePicker value={draft.range} onChange={(value) => setDraft((state) => ({ ...state, range: value as [Dayjs, Dayjs] | null }))} />
                    <Select
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        style={{ width: 220 }}
                        placeholder={t("openPlatform.logs.filterModel")}
                        value={draft.model}
                        onChange={(value) => setDraft((state) => ({ ...state, model: value }))}
                        options={models.map((model) => ({ value: model.id, label: `${model.displayName} (${model.id})` }))}
                    />
                    <Select
                        allowClear
                        style={{ width: 200 }}
                        placeholder={t("openPlatform.logs.filterToken")}
                        value={draft.apiKeyId}
                        onChange={(value) => setDraft((state) => ({ ...state, apiKeyId: value }))}
                        options={tokens.map((token) => ({ value: token.id, label: `${token.name} (${token.keyPrefix}…${token.keyTail})` }))}
                    />
                    <Select
                        allowClear
                        style={{ width: 130 }}
                        placeholder={t("openPlatform.logs.filterStatus")}
                        value={draft.status}
                        onChange={(value) => setDraft((state) => ({ ...state, status: value }))}
                        options={[
                            { value: "success", label: t("openPlatform.logs.statuses.success") },
                            { value: "failed", label: t("openPlatform.logs.statuses.failed") },
                        ]}
                    />
                    <Button type="primary" onClick={apply}>
                        {t("common.filter")}
                    </Button>
                    <Button onClick={reset}>{t("common.reset")}</Button>
                </div>
            ) : null}

            <Table rowKey="id" size="small" scroll={{ x: 1360 }} loading={table.loading} dataSource={table.items} columns={columns} pagination={table.pagination} />
        </div>
    );
}
