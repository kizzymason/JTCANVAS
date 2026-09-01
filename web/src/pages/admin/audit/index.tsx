import { Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { adminApi, type AdminAuditLog } from "@/services/api/admin";
import { useAdminTable } from "../use-admin-table";

export default function AdminAuditPage() {
    const { t } = useTranslation();
    const table = useAdminTable<AdminAuditLog>(useCallback((params) => adminApi.audit(params), []));

    const columns: ColumnsType<AdminAuditLog> = [
        { title: t("admin.audit.time"), dataIndex: "createdAt", width: 170, render: (value: string) => new Date(value).toLocaleString() },
        { title: t("admin.audit.actor"), dataIndex: "actorName", width: 140, ellipsis: true },
        { title: t("admin.audit.action"), dataIndex: "action", width: 170, render: (value: string) => <Tag>{value}</Tag> },
        { title: t("admin.audit.target"), width: 240, ellipsis: true, render: (_value, log) => `${log.targetType}${log.targetId ? ` · ${log.targetId}` : ""}` },
        {
            title: t("admin.audit.change"),
            // Before/after are stored as JSON so any mutation shape can be recorded without a migration.
            render: (_value, log) => (
                <Typography.Paragraph className="mb-0 text-xs" ellipsis={{ rows: 2, expandable: true }}>
                    {formatChange(log)}
                </Typography.Paragraph>
            ),
        },
        { title: t("admin.audit.ip"), dataIndex: "ip", width: 130 },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.audit.title")}</h1>
                <p className="mt-1 text-sm text-stone-500">{t("admin.audit.description")}</p>
            </div>
            <Table rowKey="id" size="small" loading={table.loading} dataSource={table.items} columns={columns} pagination={table.pagination} />
        </div>
    );
}

function formatChange(log: AdminAuditLog) {
    const before = log.before ? JSON.stringify(log.before) : "";
    const after = log.after ? JSON.stringify(log.after) : "";
    if (before && after) return `${before} → ${after}`;
    return after || before || "-";
}
