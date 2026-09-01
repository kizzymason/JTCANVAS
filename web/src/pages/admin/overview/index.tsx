import { Alert, Button, Card, Modal, Statistic, Table } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { adminApi, type AdminOverview, type AdminReconcileMismatch } from "@/services/api/admin";
import { formatMoney } from "@/services/api/models";

export default function AdminOverviewPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [data, setData] = useState<AdminOverview | null>(null);
    const [mismatches, setMismatches] = useState<AdminReconcileMismatch[]>([]);
    const [dismissed, setDismissed] = useState(false);
    const [detailOpen, setDetailOpen] = useState(false);

    useEffect(() => {
        void adminApi.overview().then(setData).catch(() => undefined);
        void adminApi
            .reconcile()
            .then((result) => setMismatches(result.mismatches))
            .catch(() => undefined);
    }, []);

    return (
        <div className="flex flex-col gap-5">
            <div>
                <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.overview.title")}</h1>
                <p className="mt-1 text-sm text-stone-500">{t("admin.overview.description")}</p>
            </div>

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

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Card size="small">
                    <Statistic title={t("admin.overview.users")} value={data?.users.total ?? 0} suffix={`/ ${t("admin.overview.activeUsers", { count: data?.users.active ?? 0 })}`} />
                </Card>
                <Card size="small">
                    <Statistic title={t("admin.overview.revenue")} value={formatMoney(data?.revenue)} prefix="¥" />
                </Card>
                <Card size="small">
                    <Statistic title={t("admin.overview.spent")} value={formatMoney(data?.wallet.spent)} prefix="¥" />
                </Card>
                <Card size="small">
                    <Statistic title={t("admin.overview.outstanding")} value={formatMoney(data?.wallet.balance)} prefix="¥" />
                </Card>
                <Card size="small">
                    <Statistic title={t("admin.overview.frozen")} value={formatMoney(data?.wallet.frozen)} prefix="¥" />
                </Card>
                <Card size="small">
                    <Statistic title={t("admin.overview.tasks")} value={data?.tasks.total ?? 0} />
                </Card>
                <Card size="small">
                    <Statistic title={t("admin.overview.running")} value={data?.tasks.running ?? 0} />
                </Card>
                <Card size="small">
                    <Statistic title={t("admin.overview.failed7d")} value={data?.tasks.failed7d ?? 0} />
                </Card>
            </div>
        </div>
    );
}
