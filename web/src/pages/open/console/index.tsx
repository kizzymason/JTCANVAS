import { Alert, Segmented, Spin, Table, Tag } from "antd";
import Decimal from "decimal.js";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { formatMoney } from "@/services/api/models";
import { resellerApi, type ResellerOverview, type RealtimeThroughput } from "@/services/api/reseller";
import { OpsBars, OpsDonut, OpsKpi, OpsPanel } from "@/pages/admin/ops-charts";

const REALTIME_INTERVAL_MS = 5000;

function money(value: string) {
    try {
        return new Decimal(value).toNumber();
    } catch {
        return 0;
    }
}

export default function OpenConsoleDashboardPage() {
    const { t } = useTranslation();
    const [days, setDays] = useState(1);
    const [data, setData] = useState<ResellerOverview | null>(null);
    const [live, setLive] = useState<RealtimeThroughput | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");

    const load = useCallback(
        async (window: number) => {
            try {
                const result = await resellerApi.overview(window);
                setData(result);
                setLive(result.throughput);
                setLoadError("");
            } catch (error) {
                setLoadError(error instanceof ApiError ? error.message : t("openPlatform.dashboard.loadFailed"));
            } finally {
                setLoading(false);
            }
        },
        [t],
    );

    useEffect(() => {
        setLoading(true);
        void load(days);
    }, [days, load]);

    // The throughput block is the only thing that has to feel live, so it polls on its own.
    useEffect(() => {
        const timer = window.setInterval(() => {
            void resellerApi
                .realtime()
                .then(setLive)
                .catch(() => undefined);
        }, REALTIME_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, []);

    const today = data?.today;
    const yesterday = data?.yesterday;
    // Today-vs-yesterday is shown as two absolute values rather than a delta, per the brief.
    const dayHint = (todayValue: string | number, yesterdayValue: string | number) => t("openPlatform.dashboard.dayHint", { today: todayValue, yesterday: yesterdayValue });

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500">{t("openPlatform.dashboard.label")}</p>
                    <h1 className="mt-1 text-xl font-semibold text-stone-950 dark:text-stone-100">{t("openPlatform.dashboard.title")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{t("openPlatform.dashboard.description")}</p>
                </div>
                <Segmented
                    value={days}
                    onChange={(value) => setDays(Number(value))}
                    options={[
                        { value: 1, label: t("openPlatform.dashboard.rangeToday") },
                        { value: 3, label: t("openPlatform.dashboard.range3d") },
                        { value: 7, label: t("openPlatform.dashboard.range7d") },
                    ]}
                />
            </div>

            {loadError ? <Alert type="error" showIcon message={loadError} /> : null}

            {loading ? (
                <div className="flex min-h-[240px] items-center justify-center">
                    <Spin />
                </div>
            ) : (
                <>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <OpsKpi label={t("openPlatform.dashboard.todayTokens")} value={String(today?.totalTokens ?? 0)} hint={dayHint(today?.totalTokens ?? 0, yesterday?.totalTokens ?? 0)} />
                        <OpsKpi label={t("openPlatform.dashboard.todayCost")} value={`¥${formatMoney(today?.billedAmount)}`} hint={dayHint(`¥${formatMoney(today?.billedAmount)}`, `¥${formatMoney(yesterday?.billedAmount)}`)} />
                        <OpsKpi label={t("openPlatform.dashboard.todayRequests")} value={String(today?.requests ?? 0)} hint={dayHint(today?.requests ?? 0, yesterday?.requests ?? 0)} />
                        <OpsKpi
                            label={t("openPlatform.dashboard.totalTokensLabel")}
                            value={String(data?.tokens.total ?? 0)}
                            hint={t("openPlatform.dashboard.activeTokensHint", { today: data?.tokens.activeToday ?? 0, yesterday: data?.tokens.activeYesterday ?? 0 })}
                        />
                    </div>

                    <OpsPanel
                        title={t("openPlatform.dashboard.throughput")}
                        caption={t("openPlatform.dashboard.throughputCaption")}
                        extra={
                            <span className="inline-flex items-center gap-1.5">
                                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                                {t("openPlatform.dashboard.live")}
                            </span>
                        }
                    >
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {[
                                { label: "QPS", value: live?.qps ?? 0 },
                                { label: "RPM", value: live?.rpm ?? 0 },
                                { label: "TPM", value: live?.tpm ?? 0 },
                                { label: "Task", value: live?.tasks ?? 0 },
                            ].map((item) => (
                                <div key={item.label} className="border border-stone-200 px-3 py-2 dark:border-stone-800">
                                    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-500">{item.label}</div>
                                    <div className="mt-1 text-2xl font-semibold tabular-nums text-stone-950 dark:text-stone-100">{item.value}</div>
                                </div>
                            ))}
                        </div>
                    </OpsPanel>

                    <div className="grid gap-3 xl:grid-cols-3">
                        <div className="xl:col-span-2">
                            <OpsPanel title={t("openPlatform.dashboard.recent")} caption={t("openPlatform.dashboard.recentCaption")}>
                                <Table
                                    rowKey="id"
                                    size="small"
                                    pagination={false}
                                    locale={{ emptyText: t("openPlatform.dashboard.empty") }}
                                    dataSource={data?.recent ?? []}
                                    columns={[
                                        { title: t("openPlatform.logs.time"), dataIndex: "createdAt", width: 170, render: (value: string) => new Date(value).toLocaleString() },
                                        {
                                            title: t("openPlatform.logs.capability"),
                                            dataIndex: "capability",
                                            width: 90,
                                            render: (value: string) => t(`settingsPanels.model.capabilities.${value}`, { defaultValue: value }),
                                        },
                                        { title: t("openPlatform.logs.model"), dataIndex: "model", ellipsis: true },
                                        {
                                            title: t("openPlatform.logs.tokens"),
                                            width: 120,
                                            align: "right",
                                            render: (_value, row) => <span className="tabular-nums">{row.inputTokens + row.outputTokens}</span>,
                                        },
                                        {
                                            title: t("openPlatform.logs.amount"),
                                            dataIndex: "billedAmount",
                                            width: 110,
                                            align: "right",
                                            render: (value: string) => <span className="tabular-nums">{`¥${formatMoney(value)}`}</span>,
                                        },
                                        {
                                            title: t("openPlatform.logs.status"),
                                            dataIndex: "status",
                                            width: 90,
                                            render: (value: string) => <Tag color={value === "success" ? "green" : "red"}>{t(`openPlatform.logs.statuses.${value}`)}</Tag>,
                                        },
                                    ]}
                                />
                            </OpsPanel>
                        </div>
                        <OpsDonut
                            title={t("openPlatform.dashboard.distribution")}
                            caption={t("openPlatform.dashboard.distributionCaption", { days: data?.distributionDays ?? 1 })}
                            slices={(data?.distribution ?? []).length > 0 ? (data?.distribution ?? []).map((row) => ({ label: row.model, value: Number(money(row.amount).toFixed(2)) })) : [{ label: t("openPlatform.dashboard.empty"), value: 0 }]}
                        />
                    </div>

                    <OpsBars
                        title={t("openPlatform.dashboard.requestsByModel")}
                        caption={t("openPlatform.dashboard.distributionCaption", { days: data?.distributionDays ?? 1 })}
                        unit={t("openPlatform.dashboard.requestUnit")}
                        items={(data?.distribution ?? []).length > 0 ? (data?.distribution ?? []).map((row) => ({ label: row.model, value: row.requests, hint: `¥${formatMoney(row.amount)}` })) : [{ label: t("openPlatform.dashboard.empty"), value: 0 }]}
                    />
                </>
            )}
        </div>
    );
}
