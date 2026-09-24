import { App, Badge, Button, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import Decimal from "decimal.js";
import { Check, Filter, Search, Settings2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { adminApi, type AdminReseller, type AdminResellerCounts, type AdminResellerStatus, type AdminResellerTier } from "@/services/api/admin";
import { formatMoney } from "@/services/api/models";
import { useAdminTable } from "../use-admin-table";

/** The stored value is a coefficient; admins think in percentage surcharge, so convert on display. */
function surchargeLabel(multiplier: string | null | undefined) {
    if (multiplier === null || multiplier === undefined) return "-";
    try {
        const value = new Decimal(multiplier).times(100);
        if (value.isZero()) return "0%";
        return `${value.isPositive() ? "+" : ""}${value.toDecimalPlaces(2).toString()}%`;
    } catch {
        return "-";
    }
}

function coefficientLabel(multiplier: string) {
    try {
        return `×${new Decimal(multiplier).toDecimalPlaces(4).toString()}`;
    } catch {
        return "×1";
    }
}

const STATUS_COLOR: Record<AdminResellerStatus, string> = { pending: "orange", approved: "green", rejected: "red", suspended: "default" };

export default function AdminResellersPage() {
    const { t } = useTranslation();
    const [tab, setTab] = useState<"pending" | "all">("pending");
    const [counts, setCounts] = useState<AdminResellerCounts | null>(null);
    const [tiers, setTiers] = useState<AdminResellerTier[]>([]);

    const loadMeta = useCallback(async () => {
        const [countResult, tierResult] = await Promise.all([adminApi.resellerCounts(), adminApi.resellerTiers()]);
        setCounts(countResult);
        setTiers(tierResult.items);
    }, []);

    useEffect(() => {
        void loadMeta().catch(() => undefined);
    }, [loadMeta]);

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.resellers.title")}</h1>
                <p className="mt-1 text-sm text-stone-500">{t("admin.resellers.description")}</p>
            </div>

            <Tabs
                activeKey={tab}
                onChange={(key) => setTab(key as typeof tab)}
                items={[
                    {
                        key: "pending",
                        label: (
                            <span className="inline-flex items-center gap-2">
                                {t("admin.resellers.tabPending")}
                                <Badge count={counts?.pending ?? 0} showZero={false} />
                            </span>
                        ),
                        children: <ResellerTable status="pending" tiers={tiers} onChanged={loadMeta} />,
                    },
                    {
                        key: "all",
                        label: t("admin.resellers.tabAll"),
                        children: <ResellerTable tiers={tiers} onChanged={loadMeta} />,
                    },
                ]}
            />
        </div>
    );
}

function ResellerTable({ status, tiers, onChanged }: { status?: AdminResellerStatus; tiers: AdminResellerTier[]; onChanged: () => Promise<void> }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [keyword, setKeyword] = useState("");
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<AdminResellerStatus | undefined>(status);
    const [tierFilter, setTierFilter] = useState<string | undefined>();
    const [filterOpen, setFilterOpen] = useState(false);
    const [detail, setDetail] = useState<AdminReseller | null>(null);
    const [reviewing, setReviewing] = useState<{ reseller: AdminReseller; decision: "approve" | "reject" } | null>(null);
    const [adjusting, setAdjusting] = useState<AdminReseller | null>(null);

    const table = useAdminTable<AdminReseller>(
        useCallback(
            (params) => adminApi.resellers({ ...params, status: statusFilter, tierId: tierFilter, keyword: query || undefined }),
            [query, statusFilter, tierFilter],
        ),
        [query, statusFilter, tierFilter],
    );

    const refresh = async () => {
        await Promise.all([table.reload(), onChanged()]);
    };

    const columns: ColumnsType<AdminReseller> = [
        {
            title: t("admin.resellers.company"),
            dataIndex: "companyName",
            ellipsis: true,
            render: (value: string, row) => (
                <div className="min-w-0">
                    <div className="truncate">{value || "-"}</div>
                    <div className="truncate text-xs text-stone-500">{row.username}</div>
                </div>
            ),
        },
        {
            title: t("admin.resellers.status"),
            dataIndex: "status",
            width: 100,
            render: (value: AdminResellerStatus) => <Tag color={STATUS_COLOR[value]}>{t(`admin.resellers.statuses.${value}`)}</Tag>,
        },
        { title: t("admin.resellers.tier"), dataIndex: "tierName", width: 110, render: (value: string | null) => value || "-" },
        {
            title: t("admin.resellers.surcharge"),
            width: 140,
            align: "right",
            render: (_value, row) => (
                <Tooltip title={coefficientLabel(row.multiplier)}>
                    <span className="tabular-nums">
                        {surchargeLabel(row.multiplierOverride ?? row.tierMultiplier)}
                        {row.multiplierOverride !== null ? <Tag className="ml-2">{t("admin.resellers.override")}</Tag> : null}
                    </span>
                </Tooltip>
            ),
        },
        { title: t("admin.resellers.keys"), dataIndex: "keyCount", width: 80, align: "right" },
        { title: t("admin.resellers.requests"), dataIndex: "requests", width: 100, align: "right" },
        {
            title: t("admin.resellers.spend"),
            dataIndex: "billedAmount",
            width: 120,
            align: "right",
            render: (value: string) => <span className="tabular-nums">{`¥${formatMoney(value)}`}</span>,
        },
        { title: t("admin.resellers.appliedAt"), dataIndex: "appliedAt", width: 160, render: (value: string) => new Date(value).toLocaleString() },
        {
            title: t("admin.resellers.actions"),
            width: 260,
            render: (_value, row) => (
                <Space size={0} wrap>
                    <Button size="small" type="text" onClick={() => setDetail(row)}>
                        {t("common.details")}
                    </Button>
                    {row.status === "pending" ? (
                        <>
                            <Button size="small" type="text" icon={<Check className="size-3.5" />} onClick={() => setReviewing({ reseller: row, decision: "approve" })}>
                                {t("admin.resellers.approve")}
                            </Button>
                            <Button size="small" type="text" danger icon={<X className="size-3.5" />} onClick={() => setReviewing({ reseller: row, decision: "reject" })}>
                                {t("admin.resellers.reject")}
                            </Button>
                        </>
                    ) : null}
                    <Button size="small" type="text" icon={<Settings2 className="size-3.5" />} onClick={() => setAdjusting(row)}>
                        {t("admin.resellers.adjust")}
                    </Button>
                </Space>
            ),
        },
    ];

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Space.Compact className="max-w-md">
                    <Input value={keyword} placeholder={t("admin.resellers.searchPlaceholder")} allowClear onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => { table.setPage(1); setQuery(keyword.trim()); }} />
                    <Button icon={<Search className="size-4" />} onClick={() => { table.setPage(1); setQuery(keyword.trim()); }} />
                </Space.Compact>
                <Space wrap>
                    <Button icon={<Filter className="size-4" />} type={filterOpen ? "primary" : "default"} onClick={() => setFilterOpen((open) => !open)}>
                        {t("common.filter")}
                    </Button>
                </Space>
            </div>

            {filterOpen ? (
                <div className="flex flex-wrap items-center gap-2 border border-stone-200 p-3 dark:border-stone-800">
                    <Select
                        allowClear
                        style={{ width: 150 }}
                        placeholder={t("admin.resellers.status")}
                        value={statusFilter}
                        onChange={(value) => {
                            table.setPage(1);
                            setStatusFilter(value);
                        }}
                        options={(["pending", "approved", "rejected", "suspended"] as AdminResellerStatus[]).map((value) => ({ value, label: t(`admin.resellers.statuses.${value}`) }))}
                    />
                    <Select
                        allowClear
                        style={{ width: 180 }}
                        placeholder={t("admin.resellers.tier")}
                        value={tierFilter}
                        onChange={(value) => {
                            table.setPage(1);
                            setTierFilter(value);
                        }}
                        options={tiers.map((tier) => ({ value: tier.id, label: tier.name }))}
                    />
                </div>
            ) : null}

            <Table rowKey="userId" size="small" scroll={{ x: 1400 }} loading={table.loading} dataSource={table.items} columns={columns} pagination={table.pagination} />

            <Modal open={Boolean(detail)} width={640} title={t("admin.resellers.detailTitle")} footer={null} onCancel={() => setDetail(null)} destroyOnHidden>
                <Descriptions
                    column={1}
                    size="small"
                    items={[
                        { key: "username", label: t("admin.resellers.user"), children: detail?.username },
                        { key: "company", label: t("admin.resellers.company"), children: detail?.companyName || "-" },
                        { key: "email", label: t("admin.resellers.email"), children: detail?.contactEmail || "-" },
                        { key: "website", label: t("admin.resellers.website"), children: detail?.website || "-" },
                        { key: "useCase", label: t("admin.resellers.useCase"), children: <span className="whitespace-pre-wrap">{detail?.useCase || "-"}</span> },
                        { key: "tier", label: t("admin.resellers.tier"), children: detail?.tierName || "-" },
                        { key: "surcharge", label: t("admin.resellers.surcharge"), children: `${surchargeLabel(detail?.multiplierOverride ?? detail?.tierMultiplier)} (${coefficientLabel(detail?.multiplier ?? "1")})` },
                        { key: "reject", label: t("admin.resellers.rejectReason"), children: detail?.rejectReason || "-" },
                    ]}
                />
            </Modal>

            <ReviewModal
                review={reviewing}
                tiers={tiers}
                onClose={() => setReviewing(null)}
                onDone={async () => {
                    message.success(t("admin.resellers.reviewed"));
                    await refresh();
                }}
            />
            <AdjustModal
                reseller={adjusting}
                tiers={tiers}
                onClose={() => setAdjusting(null)}
                onDone={async () => {
                    message.success(t("admin.saved"));
                    await refresh();
                }}
            />
        </div>
    );
}

function ReviewModal({
    review,
    tiers,
    onClose,
    onDone,
}: {
    review: { reseller: AdminReseller; decision: "approve" | "reject" } | null;
    tiers: AdminResellerTier[];
    onClose: () => void;
    onDone: () => Promise<void>;
}) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [form] = Form.useForm<{ tierId?: string; rejectReason?: string }>();
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!review) return;
        form.setFieldsValue({ tierId: review.reseller.tierId ?? tiers.find((tier) => tier.isDefault)?.id, rejectReason: "" });
    }, [form, review, tiers]);

    const submit = async () => {
        if (!review) return;
        const values = await form.validateFields();
        setSaving(true);
        try {
            await adminApi.reviewReseller(review.reseller.userId, { decision: review.decision, ...values });
            await onDone();
            onClose();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open={Boolean(review)}
            title={t(review?.decision === "reject" ? "admin.resellers.rejectTitle" : "admin.resellers.approveTitle")}
            onCancel={onClose}
            onOk={() => void submit()}
            confirmLoading={saving}
            okText={t("common.save")}
            destroyOnHidden
        >
            <Form form={form} layout="vertical" requiredMark={false}>
                {review?.decision === "approve" ? (
                    <Form.Item name="tierId" label={t("admin.resellers.tier")} extra={t("admin.resellers.tierHint")} rules={[{ required: true }]}>
                        <Select options={tiers.map((tier) => ({ value: tier.id, label: `${tier.name} (${surchargeLabel(tier.multiplier)})` }))} />
                    </Form.Item>
                ) : (
                    <Form.Item name="rejectReason" label={t("admin.resellers.rejectReason")} rules={[{ required: true, max: 500 }]}>
                        <Input.TextArea rows={4} placeholder={t("admin.resellers.rejectReasonPlaceholder")} />
                    </Form.Item>
                )}
            </Form>
        </Modal>
    );
}

function AdjustModal({ reseller, tiers, onClose, onDone }: { reseller: AdminReseller | null; tiers: AdminResellerTier[]; onClose: () => void; onDone: () => Promise<void> }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [form] = Form.useForm<{ tierId?: string; surchargePercent?: number | null; status?: AdminResellerStatus }>();
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!reseller) return;
        form.setFieldsValue({
            tierId: reseller.tierId ?? undefined,
            surchargePercent: reseller.multiplierOverride === null ? null : new Decimal(reseller.multiplierOverride).times(100).toNumber(),
            status: reseller.status === "suspended" || reseller.status === "approved" ? reseller.status : undefined,
        });
    }, [form, reseller]);

    const submit = async () => {
        if (!reseller) return;
        const values = await form.validateFields();
        const hasOverride = values.surchargePercent !== null && values.surchargePercent !== undefined;
        setSaving(true);
        try {
            await adminApi.updateReseller(reseller.userId, {
                tierId: values.tierId,
                status: values.status,
                // Percent is the admin-facing unit; the API stores the signed surcharge.
                ...(hasOverride ? { multiplierOverride: new Decimal(values.surchargePercent!).dividedBy(100).toFixed(6) } : { clearMultiplierOverride: true }),
            });
            await onDone();
            onClose();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open={Boolean(reseller)} title={t("admin.resellers.adjustTitle")} onCancel={onClose} onOk={() => void submit()} confirmLoading={saving} okText={t("common.save")} destroyOnHidden>
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item name="tierId" label={t("admin.resellers.tier")}>
                    <Select allowClear options={tiers.map((tier) => ({ value: tier.id, label: `${tier.name} (${surchargeLabel(tier.multiplier)})` }))} />
                </Form.Item>
                <Form.Item name="surchargePercent" label={t("admin.resellers.overrideSurcharge")} extra={t("admin.resellers.overrideHint")}>
                    <InputNumber min={-99} max={10000} step={1} addonAfter="%" className="w-full" placeholder={t("admin.resellers.useTier")} />
                </Form.Item>
                <Form.Item name="status" label={t("admin.resellers.status")} extra={t("admin.resellers.statusHint")}>
                    <Select
                        options={(["approved", "suspended"] as AdminResellerStatus[]).map((value) => ({ value, label: t(`admin.resellers.statuses.${value}`) }))}
                    />
                </Form.Item>
            </Form>
        </Modal>
    );
}
