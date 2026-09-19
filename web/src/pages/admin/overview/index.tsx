import { Alert, Button, Modal, Spin, Table } from "antd";
import Decimal from "decimal.js";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/services/api/client";
import { adminApi, type AdminOverview, type AdminReconcileMismatch } from "@/services/api/admin";
import { formatMoney } from "@/services/api/models";
import { OpsBars, OpsDonut, OpsKpi, OpsLineChart } from "../ops-charts";

function chartMoney(value: string) {
    try {
        return new Decimal(value).toNumber();
    } catch {
        return 0;
    }
}

export default function AdminOverviewPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [data, setData] = useState<AdminOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [mismatches, setMismatches] = useState<AdminReconcileMismatch[]>([]);
    const [dismissed, setDismissed] = useState(false);
    const [detailOpen, setDetailOpen] = useState(false);
    const [clock, setClock] = useState(() => new Date());

    useEffect(() => {
        const timer = window.setInterval(() => setClock(new Date()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        void adminApi
            .overview()
            .then((result) => {
                setData(result);
                setLoadError("");
            })
            .catch((error) => setLoadError(error instanceof ApiError ? error.message : t("admin.overview.loadFailed")))
            .finally(() => setLoading(false));
        void adminApi
            .reconcile()
            .then((result) => setMismatches(result.mismatches))
            .catch(() => undefined);
    }, [t]);

    const dates = data?.series.map((row) => row.date) ?? [];
    const taskSlices = useMemo(
        () => (data?.tasksByStatus ?? []).map((row) => ({ label: t(`account.taskStatus.${row.status}`), value: row.count })),
        [data?.tasksByStatus, t],
    );
    const capabilityBars = useMemo(
        () => (data?.tasksByCapability ?? []).map((row) => ({ label: t(`settingsPanels.model.capabilities.${row.capability}`), value: row.count })),
        [data?.tasksByCapability, t],
    );

    return (
        <div className="flex flex-col gap-4 bg-[linear-gradient(to_right,rgba(120,113,108,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(120,113,108,0.08)_1px,transparent_1px)] bg-[size:28px_28px]">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500">{t("admin.overview.opsLabel")}</p>
                    <h1 className="mt-1 text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.overview.title")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{t("admin.overview.description")}</p>
                </div>
                <p className="font-mono text-xs tabular-nums text-stone-500">{clock.toLocaleString()}</p>
            </div>

            {loadError ? <Alert type="error" showIcon message={loadError} /> : null}

            {mismatches.length > 0 && !dismissed ? (
                <Alert
                    type="error"
                    showIcon
                    closable
                    onClose={() => setDismissed(true)}
                    message={t("admin.overview.reconcileFailed", { count: mismatches.length })}
                    description={t("admin.overview.reconcileFailedHint")}
                    action={
                        <Button size="small" onClick={() => setDetailOpen(true)}>
                            {t("admin.overview.viewDetails")}
                        </Button>
                    }
                />
            ) : null}

            <Modal
                open={detailOpen}
                width={720}
                title={t("admin.overview.reconcileDetailTitle", { count: mismatches.length })}
                onCancel={() => setDetailOpen(false)}
                footer={
                    <Button type="primary" onClick={() => navigate("/admin/finance")}>
                        {t("admin.overview.openFinance")}
                    </Button>
                }
            >
                <p className="mb-3 text-sm text-stone-500">{t("admin.overview.reconcileFailedHint")}</p>
                <Table
                    rowKey="userId"
                    size="small"
                    pagination={false}
                    dataSource={mismatches}
                    columns={[
                        { title: t("admin.finance.user"), dataIndex: "username", ellipsis: true },
                        { title: t("admin.finance.userId"), dataIndex: "userId" },
                        { title: t("admin.finance.walletBalance"), dataIndex: "expected", align: "right", render: (value: string) => `¥${formatMoney(value)}` },
                        { title: t("admin.finance.ledgerSum"), dataIndex: "actual", align: "right", render: (value: string) => `¥${formatMoney(value)}` },
                    ]}
                />
            </Modal>

            {loading ? (
                <div className="flex h-full min-h-[240px] items-center justify-center bg-background">
                    <Spin />
                </div>
            ) : (
                <>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <OpsKpi label={t("admin.overview.users")} value={String(data?.users.total ?? 0)} hint={t("admin.overview.activeUsers", { count: data?.users.active ?? 0 })} />
                        <OpsKpi label={t("admin.overview.revenue")} value={`¥${formatMoney(data?.wallet.recharged ?? data?.revenue)}`} hint={t("admin.overview.outstandingHint", { amount: formatMoney(data?.wallet.balance) })} />
                        <OpsKpi label={t("admin.overview.spent")} value={`¥${formatMoney(data?.wallet.spent)}`} hint={t("admin.overview.frozenHint", { amount: formatMoney(data?.wallet.frozen) })} />
                        <OpsKpi label={t("admin.overview.tasks")} value={String(data?.tasks.total ?? 0)} hint={t("admin.overview.taskHint", { running: data?.tasks.running ?? 0, failed: data?.tasks.failed7d ?? 0 })} />
                    </div>

                    <div className="grid gap-3 xl:grid-cols-3">
                        <div className="xl:col-span-2">
                            <OpsLineChart
                                title={t("admin.overview.trend14d")}
                                caption={t("admin.overview.trendCaption")}
                                dates={dates}
                                unit={t("admin.overview.chartUnit")}
                                series={[
                                    { id: "tasks", label: t("admin.overview.generations"), values: data?.series.map((row) => row.tasks) ?? [], tone: "primary" },
                                    { id: "users", label: t("admin.overview.newUsers"), values: data?.series.map((row) => row.users) ?? [], tone: "muted" },
                                    { id: "failed", label: t("admin.overview.failed"), values: data?.series.map((row) => row.failed) ?? [], tone: "faint" },
                                ]}
                            />
                        </div>
                        <OpsDonut title={t("admin.overview.taskStatus")} slices={taskSlices.length > 0 ? taskSlices : [{ label: t("admin.overview.empty"), value: 0 }]} />
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2">
                        <OpsLineChart
                            title={t("admin.overview.moneyTrend")}
                            caption={t("admin.overview.moneyCaption")}
                            dates={dates}
                            unit={t("admin.overview.yuan")}
                            formatValue={(value) => `¥${formatMoney(value)}`}
                            series={[
                                { id: "revenue", label: t("admin.overview.credits"), values: data?.series.map((row) => chartMoney(row.revenue)) ?? [], tone: "primary" },
                                { id: "spent", label: t("admin.overview.spend"), values: data?.series.map((row) => chartMoney(row.spent)) ?? [], tone: "muted" },
                            ]}
                        />
                        <OpsBars
                            title={t("admin.overview.taskCapability")}
                            items={capabilityBars.length > 0 ? capabilityBars : [{ label: t("admin.overview.empty"), value: 0 }]}
                            unit={t("admin.overview.chartUnit")}
                        />
                    </div>
                </>
            )}
        </div>
    );
}
