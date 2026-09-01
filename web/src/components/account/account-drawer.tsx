import { App, Button, Card, Drawer, Form, Input, Modal, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ChevronRight, History, ReceiptText, ScrollText, Shield } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";

import { AccountRechargeModal } from "@/components/account/account-recharge-modal";
import { LocalDataMigrationCard } from "@/components/account/local-data-migration-card";
import { WalletBalanceCard } from "@/components/account/wallet-balance-card";
import { changePassword, fetchLedger, fetchOrders, type LedgerEntry, type OrderRecord } from "@/services/api/account";
import { ApiError } from "@/services/api/client";
import { fetchTasks, type GenerationTask } from "@/services/api/generation";
import { formatMoney } from "@/services/api/models";
import { useAccountDrawerStore } from "@/stores/use-account-drawer-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { useConfigStore } from "@/stores/use-config-store";

const PAGE_SIZE = 20;
const TABLE_SCROLL = { x: 640 };
/** Narrower than the preferences drawer (520), but wide enough for a landscape bank card. */
const WALLET_DRAWER_SIZE = "min(420px, 100%)";
/** About half the viewport on desktop, capped so tables stay readable; phones still use full width. */
const SECTION_DRAWER_SIZE = "min(max(50vw, 560px), 720px, 100%)";
const SECTION_DRAWER_Z = 1100;

type AccountSection = "ledger" | "usage" | "orders" | "security";

/**
 * Wallet, recharge, usage and password live in a right-hand drawer so they stay available on the
 * canvas and workbenches instead of sending the user to a separate page.
 */
export function AccountDrawer() {
    const { t } = useTranslation();
    const isOpen = useAccountDrawerStore((state) => state.isOpen);
    const close = useAccountDrawerStore((state) => state.close);
    const refreshWallet = useAuthStore((state) => state.refreshWallet);
    const logout = useAuthStore((state) => state.logout);
    const [section, setSection] = useState<AccountSection | null>(null);
    const [rechargeOpen, setRechargeOpen] = useState(false);
    const [withdrawOpen, setWithdrawOpen] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        useConfigStore.getState().closeConfigDialog();
        void refreshWallet();
    }, [isOpen, refreshWallet]);

    useEffect(() => {
        if (isOpen) return;
        setSection(null);
        setRechargeOpen(false);
        setWithdrawOpen(false);
    }, [isOpen]);

    const closeWallet = () => {
        setSection(null);
        setRechargeOpen(false);
        setWithdrawOpen(false);
        close();
    };

    const sectionItems: { key: AccountSection; icon: typeof ScrollText; label: string }[] = [
        { key: "ledger", icon: ScrollText, label: t("account.tabs.ledger") },
        { key: "usage", icon: History, label: t("account.tabs.usage") },
        { key: "orders", icon: ReceiptText, label: t("account.tabs.orders") },
        { key: "security", icon: Shield, label: t("account.tabs.security") },
    ];

    return (
        <>
            <Drawer
                title={t("account.title")}
                placement="right"
                size={WALLET_DRAWER_SIZE}
                open={isOpen}
                onClose={closeWallet}
                destroyOnHidden
                push={false}
                styles={{ wrapper: { maxWidth: "100%" }, body: { paddingTop: 12 } }}
            >
                <WalletBalanceCard onRecharge={() => setRechargeOpen(true)} onWithdraw={() => setWithdrawOpen(true)} />

                <LocalDataMigrationCard />

                <div className="flex flex-col gap-1.5">
                    {sectionItems.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            onClick={() => setSection(item.key)}
                            className="flex w-full items-center gap-3 rounded-md px-3 py-3.5 text-left transition hover:bg-black/5 dark:hover:bg-white/10"
                        >
                            <item.icon className="size-[18px] shrink-0 opacity-70" />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</span>
                            <ChevronRight className="size-4 shrink-0 opacity-35" />
                        </button>
                    ))}
                </div>
            </Drawer>

            <Drawer
                title={section ? t(`account.tabs.${section}`) : undefined}
                placement="right"
                size={SECTION_DRAWER_SIZE}
                open={Boolean(section)}
                onClose={() => setSection(null)}
                destroyOnHidden
                push={false}
                zIndex={SECTION_DRAWER_Z}
                styles={{ wrapper: { maxWidth: "100%" }, body: { paddingTop: 12, paddingInline: 12 } }}
            >
                {section === "ledger" ? <LedgerPanel /> : null}
                {section === "usage" ? <UsagePanel /> : null}
                {section === "orders" ? <OrdersPanel /> : null}
                {section === "security" ? (
                    <div className="max-w-md">
                        <SecurityPanel
                            onSignedOut={() => {
                                closeWallet();
                                void logout();
                            }}
                        />
                    </div>
                ) : null}
            </Drawer>

            <AccountRechargeModal open={rechargeOpen} onClose={() => setRechargeOpen(false)} />

            <Modal title={t("account.withdraw")} open={withdrawOpen} onCancel={() => setWithdrawOpen(false)} footer={null} centered destroyOnHidden width={360} zIndex={2000} styles={{ container: { maxWidth: "calc(100vw - 32px)" } }}>
                <p className="py-6 text-center text-sm text-stone-500">{t("account.withdrawComingSoon")}</p>
                <Button type="primary" block onClick={() => setWithdrawOpen(false)}>
                    {t("account.withdrawGotIt")}
                </Button>
            </Modal>
        </>
    );
}

/** Old /account bookmarks still work: open the drawer, then land on the canvas. */
export function AccountRouteRedirect() {
    const open = useAccountDrawerStore((state) => state.open);

    useLayoutEffect(() => {
        open();
    }, [open]);

    return <Navigate to="/canvas" replace />;
}

function LedgerPanel() {
    const { t } = useTranslation();
    const [page, setPage] = useState(1);
    const [data, setData] = useState<{ items: LedgerEntry[]; total: number }>({ items: [], total: 0 });
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await fetchLedger({ page, pageSize: PAGE_SIZE });
            setData({ items: result.items, total: result.total });
        } finally {
            setLoading(false);
        }
    }, [page]);

    useEffect(() => {
        void load();
    }, [load]);

    const columns: ColumnsType<LedgerEntry> = [
        { title: t("account.ledger.time"), dataIndex: "createdAt", width: 170, render: (value: string) => new Date(value).toLocaleString() },
        { title: t("account.ledger.type"), dataIndex: "type", width: 110, render: (value: string) => <Tag>{t(`account.ledgerType.${value}`)}</Tag> },
        {
            title: t("account.ledger.amount"),
            dataIndex: "amount",
            width: 120,
            align: "right",
            render: (value: string) => <span className={value.startsWith("-") ? "text-red-500" : "text-emerald-600"}>{`${value.startsWith("-") ? "" : "+"}¥${formatMoney(value)}`}</span>,
        },
        { title: t("account.ledger.balanceAfter"), dataIndex: "balanceAfter", width: 120, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
        { title: t("account.ledger.note"), dataIndex: "note", ellipsis: true },
    ];

    return <Table rowKey="id" size="small" loading={loading} dataSource={data.items} columns={columns} scroll={TABLE_SCROLL} pagination={{ current: page, pageSize: PAGE_SIZE, total: data.total, onChange: setPage, showSizeChanger: false }} />;
}

function UsagePanel() {
    const { t } = useTranslation();
    const [page, setPage] = useState(1);
    const [data, setData] = useState<{ items: GenerationTask[]; total: number }>({ items: [], total: 0 });
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await fetchTasks({ page, pageSize: PAGE_SIZE });
            setData({ items: result.items, total: result.total });
        } finally {
            setLoading(false);
        }
    }, [page]);

    useEffect(() => {
        void load();
    }, [load]);

    const columns: ColumnsType<GenerationTask> = [
        { title: t("account.usage.time"), dataIndex: "createdAt", width: 170, render: (value: string) => new Date(value).toLocaleString() },
        { title: t("account.usage.capability"), dataIndex: "capability", width: 90, render: (value: string) => t(`settingsPanels.model.capabilities.${value}`) },
        { title: t("account.usage.model"), dataIndex: "modelName", ellipsis: true },
        { title: t("account.usage.quantity"), width: 90, align: "right", render: (_value, task) => `${task.succeededCount}/${task.quantity}` },
        { title: t("account.usage.status"), dataIndex: "status", width: 100, render: (value: string) => <Tag color={statusColor(value)}>{t(`account.taskStatus.${value}`)}</Tag> },
        { title: t("account.usage.cost"), width: 110, align: "right", render: (_value, task) => `¥${formatMoney(task.status === "pending" || task.status === "running" ? task.estimatedCost : task.actualCost)}` },
        { title: t("account.usage.error"), dataIndex: "error", ellipsis: true, render: (value: string) => (value ? <span className="text-xs text-red-500">{value}</span> : "-") },
    ];

    return <Table rowKey="id" size="small" loading={loading} dataSource={data.items} columns={columns} scroll={TABLE_SCROLL} pagination={{ current: page, pageSize: PAGE_SIZE, total: data.total, onChange: setPage, showSizeChanger: false }} />;
}

function OrdersPanel() {
    const { t } = useTranslation();
    const [page, setPage] = useState(1);
    const [data, setData] = useState<{ items: OrderRecord[]; total: number }>({ items: [], total: 0 });
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await fetchOrders({ page, pageSize: PAGE_SIZE });
            setData({ items: result.items, total: result.total });
        } finally {
            setLoading(false);
        }
    }, [page]);

    useEffect(() => {
        void load();
    }, [load]);

    const columns: ColumnsType<OrderRecord> = [
        { title: t("account.orders.orderNo"), dataIndex: "orderNo", width: 220 },
        { title: t("account.orders.amount"), dataIndex: "amount", width: 110, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
        { title: t("account.orders.provider"), dataIndex: "paymentProvider", width: 120, render: (value: string) => t(`account.provider.${value}`, { defaultValue: value }) },
        { title: t("account.orders.status"), dataIndex: "status", width: 100, render: (value: string) => <Tag color={value === "paid" ? "green" : "default"}>{value}</Tag> },
        { title: t("account.orders.time"), dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() },
    ];

    return <Table rowKey="id" size="small" loading={loading} dataSource={data.items} columns={columns} scroll={TABLE_SCROLL} pagination={{ current: page, pageSize: PAGE_SIZE, total: data.total, onChange: setPage, showSizeChanger: false }} />;
}

function SecurityPanel({ onSignedOut }: { onSignedOut: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [form] = Form.useForm<{ currentPassword: string; newPassword: string; confirmPassword: string }>();
    const [submitting, setSubmitting] = useState(false);

    const submit = async (values: { currentPassword: string; newPassword: string }) => {
        setSubmitting(true);
        try {
            await changePassword(values);
            message.success(t("account.passwordChanged"));
            onSignedOut();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("account.passwordChangeFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Card size="small" title={t("account.changePassword")}>
            <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void submit(values)}>
                <Form.Item name="currentPassword" label={t("account.currentPassword")} rules={[{ required: true, message: t("account.currentPasswordRequired") }]}>
                    <Input.Password autoComplete="current-password" />
                </Form.Item>
                <Form.Item name="newPassword" label={t("account.newPassword")} rules={[{ required: true, message: t("auth.passwordRequired") }, { min: 8, message: t("auth.passwordLength") }]}>
                    <Input.Password autoComplete="new-password" />
                </Form.Item>
                <Form.Item
                    name="confirmPassword"
                    label={t("auth.confirmPassword")}
                    dependencies={["newPassword"]}
                    rules={[
                        { required: true, message: t("auth.confirmPasswordRequired") },
                        ({ getFieldValue }) => ({ validator: (_rule, value) => (!value || value === getFieldValue("newPassword") ? Promise.resolve() : Promise.reject(new Error(t("auth.passwordMismatch")))) }),
                    ]}
                >
                    <Input.Password autoComplete="new-password" />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={submitting}>
                    {t("account.changePasswordAction")}
                </Button>
                <p className="mt-3 text-xs text-stone-500">{t("account.passwordChangeNotice")}</p>
            </Form>
        </Card>
    );
}

function statusColor(status: string) {
    if (status === "succeeded") return "green";
    if (status === "partial") return "gold";
    if (status === "failed") return "red";
    if (status === "cancelled") return "default";
    return "blue";
}
