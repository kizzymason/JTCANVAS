import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { saveAs } from "file-saver";
import { Download, Filter, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { adminApi, type AdminCard, type AdminCardBatch } from "@/services/api/admin";
import { formatMoney } from "@/services/api/models";
import { useAdminTable, ADMIN_PAGE_SIZE } from "../use-admin-table";

export default function AdminCardsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [creating, setCreating] = useState(false);
    const [viewing, setViewing] = useState<AdminCardBatch | null>(null);
    const [keyword, setKeyword] = useState("");
    const [query, setQuery] = useState("");
    const [filterOpen, setFilterOpen] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);

    const table = useAdminTable<AdminCardBatch>(useCallback((params) => adminApi.cardBatches({ ...params, keyword: query || undefined }), [query]), [query]);

    const search = () => {
        table.setPage(1);
        setQuery(keyword.trim());
    };

    const columns: ColumnsType<AdminCardBatch> = [
        { title: t("admin.cards.batchName"), dataIndex: "name", ellipsis: true },
        { title: t("admin.cards.faceValue"), dataIndex: "faceValue", width: 110, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
        { title: t("admin.cards.quantity"), dataIndex: "quantity", width: 90, align: "right" },
        { title: t("admin.cards.used"), dataIndex: "usedCount", width: 90, align: "right" },
        { title: t("admin.cards.void"), dataIndex: "voidCount", width: 90, align: "right" },
        { title: t("admin.cards.expiresAt"), dataIndex: "expiresAt", width: 160, render: (value: string | null) => (value ? new Date(value).toLocaleString() : t("admin.cards.noExpiry")) },
        { title: t("admin.cards.createdAt"), dataIndex: "createdAt", width: 170, render: (value: string) => new Date(value).toLocaleString() },
        {
            title: t("admin.cards.actions"),
            width: 150,
            render: (_value, batch) => (
                <>
                    <Button size="small" type="text" onClick={() => setViewing(batch)}>
                        {t("admin.cards.view")}
                    </Button>
                    <Button size="small" type="text" icon={<Download className="size-3.5" />} onClick={() => void exportBatch(batch)}>
                        {t("admin.cards.export")}
                    </Button>
                </>
            ),
        },
    ];

    const exportBatch = async (batch: AdminCardBatch) => {
        const result = await adminApi.exportCards(batch.id);
        const text = result.cards.map((card) => `${card.code},${card.status}`).join("\n");
        saveAs(new Blob([`code,status\n${text}`], { type: "text/csv;charset=utf-8" }), `cards-${batch.name || batch.id}.csv`);
    };

    const removeSelected = async () => {
        try {
            const result = await adminApi.deleteCardBatches(selected);
            message.success(t("admin.cards.batchesDeleted", { count: result.removed }));
            if (viewing && selected.includes(viewing.id)) setViewing(null);
            setSelected([]);
            await table.reload();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.cards.title")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{t("admin.cards.description")}</p>
                </div>
                <Space wrap>
                    {selected.length ? (
                        <Popconfirm title={t("admin.cards.deleteBatchesConfirm", { count: selected.length })} onConfirm={() => void removeSelected()}>
                            <Button danger icon={<Trash2 className="size-4" />}>
                                {t("admin.cards.deleteSelected", { count: selected.length })}
                            </Button>
                        </Popconfirm>
                    ) : null}
                    <Button icon={<Filter className="size-4" />} type={filterOpen || query ? "primary" : "default"} onClick={() => setFilterOpen((open) => !open)}>
                        {t("common.filter")}
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                        {t("admin.cards.create")}
                    </Button>
                </Space>
            </div>

            {filterOpen ? (
                <Space.Compact className="max-w-md">
                    <Input value={keyword} placeholder={t("admin.cards.searchPlaceholder")} onChange={(event) => setKeyword(event.target.value)} onPressEnter={search} allowClear />
                    <Button icon={<Search className="size-4" />} onClick={search} />
                </Space.Compact>
            ) : null}

            <Table
                rowKey="id"
                size="small"
                loading={table.loading}
                dataSource={table.items}
                columns={columns}
                pagination={table.pagination}
                rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }}
            />

            <CreateModal open={creating} onClose={() => setCreating(false)} onSaved={() => void table.reload()} />
            <CardsModal batch={viewing} onClose={() => setViewing(null)} />
        </div>
    );

    function CreateModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
        const [form] = Form.useForm<{ name: string; faceValue: string; quantity: number }>();
        const [saving, setSaving] = useState(false);
        const [codes, setCodes] = useState<string[]>([]);

        const submit = async () => {
            const values = await form.validateFields();
            setSaving(true);
            try {
                const result = await adminApi.createCards(values);
                setCodes(result.codes);
                message.success(t("admin.cards.created", { count: result.codes.length }));
                onSaved();
            } catch (error) {
                message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
            } finally {
                setSaving(false);
            }
        };

        const close = () => {
            setCodes([]);
            form.resetFields();
            onClose();
        };

        return (
            <Modal open={open} title={t("admin.cards.create")} onCancel={close} onOk={codes.length ? close : () => void submit()} confirmLoading={saving} okText={t(codes.length ? "common.done" : "common.save")} destroyOnHidden>
                {codes.length ? (
                    <>
                        <p className="mb-2 text-sm text-stone-500">{t("admin.cards.createdHint")}</p>
                        <Input.TextArea rows={10} readOnly value={codes.join("\n")} className="font-mono text-xs" />
                    </>
                ) : (
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ name: "", faceValue: "10.00", quantity: 10 }}>
                        <Form.Item name="name" label={t("admin.cards.batchName")} rules={[{ required: true }]}>
                            <Input maxLength={128} />
                        </Form.Item>
                        <Form.Item name="faceValue" label={t("admin.cards.faceValue")} rules={[{ required: true }, { pattern: /^\d{1,12}(\.\d{1,6})?$/, message: t("admin.channels.priceInvalid") }]}>
                            <Input placeholder="10.00" />
                        </Form.Item>
                        <Form.Item name="quantity" label={t("admin.cards.quantity")} rules={[{ required: true }]}>
                            <InputNumber min={1} max={5000} className="w-full" />
                        </Form.Item>
                    </Form>
                )}
            </Modal>
        );
    }
}

function CardsModal({ batch, onClose }: { batch: AdminCardBatch | null; onClose: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState<string | undefined>();
    const [data, setData] = useState<{ items: AdminCard[]; total: number }>({ items: [], total: 0 });
    const [selected, setSelected] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);

    const [reloadToken, setReloadToken] = useState(0);

    useEffect(() => {
        if (!batch) {
            setPage(1);
            setStatus(undefined);
            setSelected([]);
            setData({ items: [], total: 0 });
            setReloadToken(0);
            return;
        }
        let cancelled = false;
        setLoading(true);
        void adminApi
            .cards(batch.id, { page, pageSize: ADMIN_PAGE_SIZE, status })
            .then((result) => {
                if (!cancelled) setData({ items: result.items, total: result.total });
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [batch, page, status, reloadToken]);

    const unusedSelected = selected.filter((id) => data.items.find((card) => card.id === id)?.status === "unused");

    const voidSelected = async () => {
        const result = await adminApi.voidCards(unusedSelected);
        message.success(t("admin.cards.voided", { count: result.voided }));
        setSelected([]);
        setReloadToken((value) => value + 1);
    };

    const deleteSelected = async () => {
        try {
            const result = await adminApi.deleteCards(selected);
            message.success(t("admin.cards.deleted", { count: result.removed }));
            setSelected([]);
            setReloadToken((value) => value + 1);
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        }
    };

    return (
        <Modal open={Boolean(batch)} width={760} title={t("admin.cards.viewTitle", { name: batch?.name })} onCancel={onClose} footer={null} destroyOnHidden>
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <Select
                    allowClear
                    style={{ width: 140 }}
                    placeholder={t("admin.cards.filterStatus")}
                    value={status}
                    onChange={(value) => {
                        setPage(1);
                        setStatus(value);
                        setSelected([]);
                    }}
                    options={["unused", "used", "void"].map((value) => ({ value, label: t(`admin.cards.statuses.${value}`) }))}
                />
                {unusedSelected.length ? (
                    <Button danger size="small" onClick={() => void voidSelected()}>
                        {t("admin.cards.voidSelected", { count: unusedSelected.length })}
                    </Button>
                ) : null}
                {selected.length ? (
                    <Popconfirm title={t("admin.cards.deleteCardsConfirm", { count: selected.length })} onConfirm={() => void deleteSelected()}>
                        <Button danger size="small" icon={<Trash2 className="size-3.5" />}>
                            {t("admin.cards.deleteSelected", { count: selected.length })}
                        </Button>
                    </Popconfirm>
                ) : null}
            </div>
            <Table
                rowKey="id"
                size="small"
                loading={loading}
                dataSource={data.items}
                rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }}
                pagination={{ current: page, pageSize: ADMIN_PAGE_SIZE, total: data.total, onChange: setPage, showSizeChanger: false }}
                columns={[
                    { title: t("admin.cards.code"), dataIndex: "code", render: (value: string) => <span className="font-mono text-xs">{value}</span> },
                    { title: t("admin.cards.faceValue"), dataIndex: "faceValue", width: 100, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
                    { title: t("admin.cards.status"), dataIndex: "status", width: 100, render: (value: string) => <Tag color={value === "unused" ? "green" : value === "used" ? "default" : "red"}>{t(`admin.cards.statuses.${value}`)}</Tag> },
                    { title: t("admin.cards.redeemedAt"), dataIndex: "redeemedAt", width: 170, render: (value: string | null) => (value ? new Date(value).toLocaleString() : "-") },
                ]}
            />
        </Modal>
    );
}
