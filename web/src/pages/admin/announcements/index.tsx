import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { RichTextEditor } from "@/components/announcements/rich-text-editor";
import { ApiError } from "@/services/api/client";
import { adminAnnouncementsApi, type AdminAnnouncement } from "@/services/api/announcements";
import { useAdminTable } from "../use-admin-table";

export default function AdminAnnouncementsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [keyword, setKeyword] = useState("");
    const [editing, setEditing] = useState<AdminAnnouncement | "new" | null>(null);
    const table = useAdminTable<AdminAnnouncement>(useCallback((params) => adminAnnouncementsApi.list({ ...params, keyword: keyword.trim() || undefined }), [keyword]));

    const remove = async (row: AdminAnnouncement) => {
        try {
            await adminAnnouncementsApi.remove(row.id);
            message.success(t("admin.announcements.deleted"));
            await table.reload();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        }
    };

    const columns: ColumnsType<AdminAnnouncement> = [
        {
            title: t("admin.announcements.titleColumn"),
            dataIndex: "title",
            ellipsis: true,
            render: (value: string, row) => (
                <span>
                    {row.pinned ? <Tag color="gold">{t("admin.announcements.pinned")}</Tag> : null}
                    {value}
                </span>
            ),
        },
        { title: t("admin.announcements.slug"), dataIndex: "slug", width: 180, ellipsis: true },
        {
            title: t("admin.announcements.published"),
            dataIndex: "published",
            width: 90,
            render: (value: boolean) => <Tag color={value ? "green" : "default"}>{value ? t("admin.announcements.on") : t("admin.announcements.off")}</Tag>,
        },
        { title: t("admin.announcements.sortOrder"), dataIndex: "sortOrder", width: 80, align: "right" },
        {
            title: t("admin.announcements.updatedAt"),
            dataIndex: "updatedAt",
            width: 170,
            render: (value: string) => new Date(value).toLocaleString(),
        },
        {
            title: t("admin.announcements.actions"),
            width: 140,
            render: (_value, row) => (
                <Space size={4}>
                    <Button size="small" type="text" onClick={() => setEditing(row)}>
                        {t("common.edit")}
                    </Button>
                    {row.locked ? null : (
                        <Popconfirm title={t("admin.announcements.deleteConfirm")} onConfirm={() => void remove(row)}>
                            <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} />
                        </Popconfirm>
                    )}
                </Space>
            ),
        },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.announcements.title")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{t("admin.announcements.description")}</p>
                </div>
                <Space wrap>
                    <Input.Search allowClear placeholder={t("admin.announcements.search")} onSearch={setKeyword} onChange={(event) => { if (!event.target.value) setKeyword(""); }} />
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
                        {t("admin.announcements.create")}
                    </Button>
                </Space>
            </div>

            <Table rowKey="id" size="small" loading={table.loading} dataSource={table.items} columns={columns} pagination={table.pagination} />
            <AnnouncementEditorModal
                key={editing === "new" ? "new" : editing?.id ?? "closed"}
                open={editing !== null}
                announcement={editing === "new" ? null : editing}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null);
                    void table.reload();
                }}
            />
        </div>
    );
}

function AnnouncementEditorModal({
    open,
    announcement,
    onClose,
    onSaved,
}: {
    open: boolean;
    announcement: AdminAnnouncement | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [form] = Form.useForm();
    const [content, setContent] = useState(announcement?.content || "<p></p>");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        form.resetFields();
        form.setFieldsValue(
            announcement
                ? { title: announcement.title, slug: announcement.slug, published: announcement.published, pinned: announcement.pinned, sortOrder: announcement.sortOrder }
                : { title: "", slug: "", published: true, pinned: false, sortOrder: 100 },
        );
        setContent(announcement?.content || "<p></p>");
    }, [open, announcement, form]);

    const uploadImage = async (file: File) => {
        const result = await adminAnnouncementsApi.uploadImage(file);
        return result.url;
    };

    const submit = async () => {
        const values = await form.validateFields();
        if (isContentEmpty(content)) {
            message.error(t("admin.announcements.contentRequired"));
            return;
        }
        setSaving(true);
        try {
            const body = {
                title: values.title,
                content,
                slug: values.slug?.trim() || undefined,
                published: values.published,
                pinned: values.pinned,
                sortOrder: values.sortOrder,
            };
            if (announcement) await adminAnnouncementsApi.update(announcement.id, body);
            else await adminAnnouncementsApi.create(body);
            message.success(t("admin.announcements.saved"));
            onSaved();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open={open}
            title={announcement ? t("admin.announcements.edit") : t("admin.announcements.create")}
            onCancel={onClose}
            onOk={() => void submit()}
            confirmLoading={saving}
            width={920}
            destroyOnHidden
            okText={t("common.save")}
        >
            <Form form={form} layout="vertical" requiredMark={false} className="pt-2">
                <Form.Item name="title" label={t("admin.announcements.titleColumn")} rules={[{ required: true, message: t("admin.announcements.titleRequired") }]}>
                    <Input maxLength={120} />
                </Form.Item>
                <Form.Item name="slug" label={t("admin.announcements.slug")} extra={announcement?.locked ? t("admin.announcements.slugLocked") : t("admin.announcements.slugHint")}>
                    <Input maxLength={64} disabled={announcement?.locked} placeholder="join-community" />
                </Form.Item>
                <Form.Item label={t("admin.announcements.content")} required>
                    <RichTextEditor value={content} onChange={setContent} onUploadImage={uploadImage} contentKey={open ? (announcement?.id ?? "new") : "closed"} />
                </Form.Item>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Form.Item name="published" label={t("admin.announcements.published")} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item name="pinned" label={t("admin.announcements.pinned")} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item name="sortOrder" label={t("admin.announcements.sortOrder")}>
                        <InputNumber min={0} max={10000} className="w-full" />
                    </Form.Item>
                </div>
            </Form>
        </Modal>
    );
}

function isContentEmpty(html: string) {
    const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
    if (text) return false;
    return !/<img\b/i.test(html);
}
