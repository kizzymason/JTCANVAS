import { Alert, App, Button, Input, Select, Space, Table, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Download, RefreshCw, Search } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { adminApi, type AdminLedgerEntry, type AdminOrder, type AdminReconcileMismatch } from "@/services/api/admin";
import { formatMoney } from "@/services/api/models";
import { downloadCsv, fetchAllPages } from "../export-csv";
import { useAdminTable } from "../use-admin-table";

const LEDGER_TYPES = ["recharge", "redeem", "freeze", "settle", "refund", "admin_adjust"] as const;

export default function AdminFinancePage() {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.finance.title")}</h1>
                <p className="mt-1 text-sm text-stone-500">{t("admin.finance.description")}</p>
            </div>

            <Tabs
                items={[
                    { key: "orders", label: t("admin.finance.orders"), children: <OrdersTable /> },
                    { key: "ledger", label: t("admin.finance.ledger"), children: <LedgerTable /> },
                    { key: "reconcile", label: t("admin.finance.reconcile"), children: <ReconcilePanel /> },
                ]}
            />
        </div>
    );
}

function OrdersTable() {
    const { t } = useTranslation();
    const table = useAdminTable<AdminOrder>(useCallback((params) => adminApi.orders(params), []));

    const columns: ColumnsType<AdminOrder> = [
        { title: t("admin.finance.orderNo"), dataIndex: "orderNo", width: 230 },
        { title: t("admin.finance.user"), dataIndex: "username", ellipsis: true },
        { title: t("admin.finance.amount"), dataIndex: "amount", width: 110, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
        { title: t("admin.finance.provider"), dataIndex: "paymentProvider", width: 110 },
        { title: t("admin.finance.status"), dataIndex: "status", width: 100, render: (value: string) => <Tag color={value === "paid" ? "green" : "default"}>{value}</Tag> },
        { title: t("admin.finance.time"), dataIndex: "createdAt", width: 170, render: (value: string) => new Date(value).toLocaleString() },
    ];

    return <Table rowKey="id" size="small" loading={table.loading} dataSource={table.items} columns={columns} pagination={table.pagination} />;
}

function LedgerTable() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [keyword, setKeyword] = useState("");
    const [query, setQuery] = useState("");
    const [type, setType] = useState<string | undefined>();
    const [exporting, setExporting] = useState(false);

    const table = useAdminTable<AdminLedgerEntry>(
        useCallback((params) => adminApi.ledger({ ...params, keyword: query || undefined, type }), [query, type]),
        [query, type],
    );

    const search = () => {
        table.setPage(1);
        setQuery(keyword.trim());
    };

    const exportRows = async () => {
        setExporting(true);
        try {
            const items = await fetchAllPages((params) => adminApi.ledger({ ...params, keyword: query || undefined, type }));
            downloadCsv(
                `ledger-${new Date().toISOString().slice(0, 10)}.csv`,
                [t("admin.finance.time"), t("admin.finance.user"), t("admin.finance.type"), t("admin.finance.amount"), t("admin.finance.balanceAfter"), t("admin.finance.note")],
                items.map((item) => [new Date(item.createdAt).toLocaleString(), item.username ?? "", t(`account.ledgerType.${item.type}`), item.amount, item.balanceAfter, item.note]),
            );
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.finance.exportFailed"));
        } finally {
            setExporting(false);
        }
    };

    const columns: ColumnsType<AdminLedgerEntry> = [
        { title: t("admin.finance.time"), dataIndex: "createdAt", width: 170, render: (value: string) => new Date(value).toLocaleString() },
        { title: t("admin.finance.user"), dataIndex: "username", ellipsis: true },
        { title: t("admin.finance.type"), dataIndex: "type", width: 110, render: (value: string) => <Tag>{t(`account.ledgerType.${value}`)}</Tag> },
        {
            title: t("admin.finance.amount"),
            dataIndex: "amount",
            width: 120,
            align: "right",
            render: (value: string) => <span className={value.startsWith("-") ? "text-red-500" : "text-emerald-600"}>{`${value.startsWith("-") ? "" : "+"}¥${formatMoney(value)}`}</span>,
        },
        { title: t("admin.finance.balanceAfter"), dataIndex: "balanceAfter", width: 120, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
        { title: t("admin.finance.note"), dataIndex: "note", ellipsis: true },
    ];

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <Select
                    allowClear
                    style={{ width: 160 }}
                    placeholder={t("admin.finance.filterType")}
                    value={type}
                    onChange={(value) => {
                        table.setPage(1);
                        setType(value);
                    }}
                    options={LEDGER_TYPES.map((value) => ({ value, label: t(`account.ledgerType.${value}`) }))}
                />
                <Space.Compact>
                    <Input value={keyword} placeholder={t("admin.finance.searchPlaceholder")} onChange={(event) => setKeyword(event.target.value)} onPressEnter={search} allowClear style={{ width: 220 }} />
                    <Button icon={<Search className="size-4" />} onClick={search} />
                </Space.Compact>
                <Button icon={<Download className="size-4" />} loading={exporting} onClick={() => void exportRows()}>
                    {t("common.export")}
                </Button>
            </div>
            <Table rowKey="id" size="small" loading={table.loading} dataSource={table.items} columns={columns} pagination={table.pagination} />
        </div>
    );
}

/** A mismatch means a balance was written outside the wallet service, so it is reported, never auto-fixed. */
function ReconcilePanel() {
    const { t } = useTranslation();
    const [mismatches, setMismatches] = useState<AdminReconcileMismatch[] | null>(null);
    const [loading, setLoading] = useState(false);

    const run = async () => {
        setLoading(true);
        try {
            const result = await adminApi.reconcile();
            setMismatches(result.mismatches);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
                <Button type="primary" loading={loading} icon={<RefreshCw className="size-4" />} onClick={() => void run()}>
                    {t("admin.finance.runReconcile")}
                </Button>
                <span className="text-sm text-stone-500">{t("admin.finance.reconcileHint")}</span>
            </div>

            {mismatches === null ? null : mismatches.length ? (
                <>
                    <Alert type="error" showIcon message={t("admin.finance.reconcileFailed", { count: mismatches.length })} description={t("admin.finance.reconcileFailedHint")} />
                    <Table
                        rowKey="userId"
                        size="small"
                        dataSource={mismatches}
                        pagination={false}
                        columns={[
                            { title: t("admin.finance.user"), dataIndex: "username", ellipsis: true },
                            { title: t("admin.finance.userId"), dataIndex: "userId" },
                            { title: t("admin.finance.walletBalance"), dataIndex: "expected", align: "right", render: (value: string) => `¥${formatMoney(value)}` },
                            { title: t("admin.finance.ledgerSum"), dataIndex: "actual", align: "right", render: (value: string) => `¥${formatMoney(value)}` },
                        ]}
                    />
                </>
            ) : (
                <Alert type="success" showIcon message={t("admin.finance.reconcileOk")} />
            )}
        </div>
    );
}
