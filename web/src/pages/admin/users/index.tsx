import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Coins, Search, Trash2, UserCog } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { adminApi, type AdminUser } from "@/services/api/admin";
import { formatMoney } from "@/services/api/models";
import { useAuthStore } from "@/stores/use-auth-store";
import { useAdminTable } from "../use-admin-table";

export default function AdminUsersPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const currentUserId = useAuthStore((state) => state.user?.id);
    const [keyword, setKeyword] = useState("");
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<string[]>([]);
    const [editing, setEditing] = useState<AdminUser | null>(null);
    const [adjusting, setAdjusting] = useState<AdminUser | null>(null);

    const fetcher = useCallback((params: { page: number; pageSize: number }) => adminApi.users({ ...params, keyword: query || undefined }), [query]);
    const table = useAdminTable<AdminUser>(fetcher, [query]);

    const search = () => {
        table.setPage(1);
        setQuery(keyword.trim());
    };

    const removeSelected = async () => {
        try {
            const result = await adminApi.deleteUsers(selected);
            message.success(t("admin.users.deleted", { count: result.removed }));
            setSelected([]);
            await table.reload();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        }
    };

    const columns: ColumnsType<AdminUser> = [
        { title: t("admin.users.username"), dataIndex: "username", ellipsis: true },
        { title: t("admin.users.role"), dataIndex: "role", width: 100, render: (value: string) => <Tag color={value === "admin" ? "geekblue" : "default"}>{t(`admin.users.roles.${value}`)}</Tag> },
        { title: t("admin.users.status"), dataIndex: "status", width: 100, render: (value: string) => <Tag color={value === "active" ? "green" : "red"}>{t(`admin.users.statuses.${value}`)}</Tag> },
        { title: t("admin.users.balance"), dataIndex: "balance", width: 110, align: "right", render: (value: string | null) => `¥${formatMoney(value ?? "0")}` },
        { title: t("admin.users.frozen"), dataIndex: "frozen", width: 100, align: "right", render: (value: string | null) => `¥${formatMoney(value ?? "0")}` },
        { title: t("admin.users.totalSpent"), dataIndex: "totalSpent", width: 110, align: "right", render: (value: string | null) => `¥${formatMoney(value ?? "0")}` },
        { title: t("admin.users.lastLogin"), dataIndex: "lastLoginAt", width: 160, render: (value: string | null) => (value ? new Date(value).toLocaleString() : "-") },
        {
            title: t("admin.users.actions"),
            width: 160,
            render: (_value, user) => (
                <Space size={4}>
                    <Button size="small" type="text" icon={<UserCog className="size-3.5" />} onClick={() => setEditing(user)}>
                        {t("common.edit")}
                    </Button>
                    <Button size="small" type="text" icon={<Coins className="size-3.5" />} onClick={() => setAdjusting(user)}>
                        {t("admin.users.adjust")}
                    </Button>
                </Space>
            ),
        },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.users.title")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{t("admin.users.description")}</p>
                </div>
                <Space wrap>
                    {selected.length ? (
                        <Popconfirm title={t("admin.users.deleteConfirm", { count: selected.length })} onConfirm={() => void removeSelected()}>
                            <Button danger icon={<Trash2 className="size-4" />}>
                                {t("admin.users.deleteSelected", { count: selected.length })}
                            </Button>
                        </Popconfirm>
                    ) : null}
                    <Space.Compact>
                        <Input value={keyword} placeholder={t("admin.users.searchPlaceholder")} onChange={(event) => setKeyword(event.target.value)} onPressEnter={search} allowClear />
                        <Button icon={<Search className="size-4" />} onClick={search} />
                    </Space.Compact>
                </Space>
            </div>

            <Table
                rowKey="id"
                size="small"
                loading={table.loading}
                dataSource={table.items}
                columns={columns}
                pagination={table.pagination}
                rowSelection={{
                    selectedRowKeys: selected,
                    onChange: (keys) => setSelected(keys as string[]),
                    getCheckboxProps: (user) => ({ disabled: user.id === currentUserId }),
                }}
            />

            <EditUserModal user={editing} onClose={() => setEditing(null)} onSaved={() => void table.reload()} />
            <AdjustBalanceModal user={adjusting} onClose={() => setAdjusting(null)} onSaved={() => void table.reload()} />
        </div>
    );

    function EditUserModal({ user, onClose, onSaved }: { user: AdminUser | null; onClose: () => void; onSaved: () => void }) {
        const [form] = Form.useForm<{ role: string; status: string; displayName: string; password?: string }>();
        const [saving, setSaving] = useState(false);

        const submit = async () => {
            if (!user) return;
            const values = await form.validateFields();
            setSaving(true);
            try {
                await adminApi.updateUser(user.id, { ...values, password: values.password || undefined });
                message.success(t("admin.users.saved"));
                onSaved();
                onClose();
            } catch (error) {
                message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
            } finally {
                setSaving(false);
            }
        };

        return (
            <Modal
                open={Boolean(user)}
                title={t("admin.users.editTitle", { username: user?.username })}
                onCancel={onClose}
                onOk={() => void submit()}
                confirmLoading={saving}
                destroyOnHidden
                afterOpenChange={(open) => open && user && form.setFieldsValue({ role: user.role, status: user.status, displayName: user.displayName, password: "" })}
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="role" label={t("admin.users.role")}>
                        <Select options={[{ value: "user", label: t("admin.users.roles.user") }, { value: "admin", label: t("admin.users.roles.admin") }]} />
                    </Form.Item>
                    <Form.Item name="status" label={t("admin.users.status")} extra={t("admin.users.disableHint")}>
                        <Select options={[{ value: "active", label: t("admin.users.statuses.active") }, { value: "disabled", label: t("admin.users.statuses.disabled") }]} />
                    </Form.Item>
                    <Form.Item name="displayName" label={t("admin.users.displayName")}>
                        <Input maxLength={64} />
                    </Form.Item>
                    <Form.Item name="password" label={t("admin.users.resetPassword")} extra={t("admin.users.resetPasswordHint")} rules={[{ min: 8, message: t("auth.passwordLength") }]}>
                        <Input.Password autoComplete="new-password" />
                    </Form.Item>
                </Form>
            </Modal>
        );
    }

    function AdjustBalanceModal({ user, onClose, onSaved }: { user: AdminUser | null; onClose: () => void; onSaved: () => void }) {
        const [form] = Form.useForm<{ amount: string; note: string }>();
        const [saving, setSaving] = useState(false);

        const submit = async () => {
            if (!user) return;
            const values = await form.validateFields();
            setSaving(true);
            try {
                const result = await adminApi.adjustBalance(user.id, values);
                message.success(t("admin.users.adjusted", { balance: formatMoney(result.balance) }));
                onSaved();
                onClose();
            } catch (error) {
                message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
            } finally {
                setSaving(false);
            }
        };

        return (
            <Modal open={Boolean(user)} title={t("admin.users.adjustTitle", { username: user?.username })} onCancel={onClose} onOk={() => void submit()} confirmLoading={saving} destroyOnHidden>
                <p className="mb-4 text-sm text-stone-500">{t("admin.users.adjustHint", { balance: formatMoney(user?.balance ?? "0") })}</p>
                <Form form={form} layout="vertical" requiredMark={false} initialValues={{ amount: "", note: "" }}>
                    <Form.Item
                        name="amount"
                        label={t("admin.users.adjustAmount")}
                        extra={t("admin.users.adjustAmountHint")}
                        rules={[{ required: true, message: t("admin.users.adjustAmountRequired") }, { pattern: /^-?\d{1,12}(\.\d{1,6})?$/, message: t("admin.users.adjustAmountInvalid") }]}
                    >
                        <Input placeholder="10.00" autoComplete="off" />
                    </Form.Item>
                    <Form.Item name="note" label={t("admin.users.adjustNote")} rules={[{ required: true, message: t("admin.users.adjustNoteRequired") }]}>
                        <Input.TextArea rows={2} maxLength={200} />
                    </Form.Item>
                </Form>
            </Modal>
        );
    }
}
