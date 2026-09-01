import { App, Button, Input, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Download, Search } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { adminApi, type AdminTask } from "@/services/api/admin";
import { formatMoney } from "@/services/api/models";
import { downloadCsv, fetchAllPages } from "../export-csv";
import { useAdminTable } from "../use-admin-table";

const statuses = ["pending", "running", "succeeded", "partial", "failed", "cancelled"] as const;
const capabilities = ["image", "video", "text", "audio"] as const;

export default function AdminTasksPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [keyword, setKeyword] = useState("");
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState<string | undefined>();
    const [capability, setCapability] = useState<string | undefined>();
    const [exporting, setExporting] = useState(false);

    const table = useAdminTable<AdminTask>(
        useCallback((params) => adminApi.tasks({ ...params, status, capability, keyword: query || undefined }), [status, capability, query]),
        [status, capability, query],
    );

    const search = () => {
        table.setPage(1);
        setQuery(keyword.trim());
    };

    const exportRows = async () => {
        setExporting(true);
        try {
            const items = await fetchAllPages((params) => adminApi.tasks({ ...params, status, capability, keyword: query || undefined }));
            downloadCsv(
                `tasks-${new Date().toISOString().slice(0, 10)}.csv`,
                [t("admin.tasks.time"), t("admin.tasks.user"), t("admin.tasks.capability"), t("admin.tasks.model"), t("admin.tasks.progress"), t("admin.tasks.status"), t("admin.tasks.estimated"), t("admin.tasks.actual"), t("admin.tasks.error")],
                items.map((item) => [
                    new Date(item.createdAt).toLocaleString(),
                    item.username ?? "",
                    t(`settingsPanels.model.capabilities.${item.capability}`),
                    item.modelName,
                    `${item.succeededCount}/${item.quantity}`,
                    t(`account.taskStatus.${item.status}`),
                    item.estimatedCost,
                    item.actualCost,
                    item.error,
                ]),
            );
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.tasks.exportFailed"));
        } finally {
            setExporting(false);
        }
    };

    const columns: ColumnsType<AdminTask> = [
        { title: t("admin.tasks.time"), dataIndex: "createdAt", width: 170, render: (value: string) => new Date(value).toLocaleString() },
        { title: t("admin.tasks.user"), dataIndex: "username", width: 140, ellipsis: true },
        { title: t("admin.tasks.capability"), dataIndex: "capability", width: 80, render: (value: string) => t(`settingsPanels.model.capabilities.${value}`) },
        { title: t("admin.tasks.model"), dataIndex: "modelName", ellipsis: true },
        { title: t("admin.tasks.progress"), width: 90, align: "right", render: (_value, task) => `${task.succeededCount}/${task.quantity}` },
        { title: t("admin.tasks.status"), dataIndex: "status", width: 100, render: (value: string) => <Tag color={statusColor(value)}>{t(`account.taskStatus.${value}`)}</Tag> },
        { title: t("admin.tasks.estimated"), dataIndex: "estimatedCost", width: 100, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
        { title: t("admin.tasks.actual"), dataIndex: "actualCost", width: 100, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
        { title: t("admin.tasks.error"), dataIndex: "error", ellipsis: true, render: (value: string) => (value ? <span className="text-xs text-red-500">{value}</span> : "-") },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.tasks.title")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{t("admin.tasks.description")}</p>
                </div>
                <Space wrap>
                    <Select
                        allowClear
                        style={{ width: 140 }}
                        placeholder={t("admin.tasks.filterCapability")}
                        value={capability}
                        onChange={(value) => {
                            table.setPage(1);
                            setCapability(value);
                        }}
                        options={capabilities.map((value) => ({ value, label: t(`settingsPanels.model.capabilities.${value}`) }))}
                    />
                    <Select
                        allowClear
                        style={{ width: 140 }}
                        placeholder={t("admin.tasks.filterStatus")}
                        value={status}
                        onChange={(value) => {
                            table.setPage(1);
                            setStatus(value);
                        }}
                        options={statuses.map((value) => ({ value, label: t(`account.taskStatus.${value}`) }))}
                    />
                    <Space.Compact>
                        <Input value={keyword} placeholder={t("admin.tasks.searchPlaceholder")} onChange={(event) => setKeyword(event.target.value)} onPressEnter={search} allowClear style={{ width: 200 }} />
                        <Button icon={<Search className="size-4" />} onClick={search} />
                    </Space.Compact>
                    <Button icon={<Download className="size-4" />} loading={exporting} onClick={() => void exportRows()}>
                        {t("common.export")}
                    </Button>
                </Space>
            </div>

            <Table rowKey="id" size="small" loading={table.loading} dataSource={table.items} columns={columns} pagination={table.pagination} />
        </div>
    );
}

function statusColor(status: string) {
    if (status === "succeeded") return "green";
    if (status === "partial") return "gold";
    if (status === "failed") return "red";
    if (status === "cancelled") return "default";
    return "blue";
}
