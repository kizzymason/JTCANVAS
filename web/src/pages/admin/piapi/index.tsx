import { App, Button, Modal, Popconfirm, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { FileUp, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { adminApi, type AdminPiapiAccount } from "@/services/api/admin";
import { parsePiapiAccountCsv } from "@/lib/piapi/piapi-account-csv";

const statusColor: Record<string, string> = { active: "green", exhausted: "orange", invalid: "red", disabled: "default" };

/** PiAPI key pool, moved server-side. Keys are stored encrypted and only their last 4 chars are shown. */
export default function AdminPiapiPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [accounts, setAccounts] = useState<AdminPiapiAccount[]>([]);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [ensuring, setEnsuring] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const [importOpen, setImportOpen] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setAccounts(await adminApi.piapi());
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const refreshAll = async () => {
        setRefreshing(true);
        try {
            await adminApi.refreshPiapi();
            await load();
            message.success(t("admin.piapi.refreshed"));
        } finally {
            setRefreshing(false);
        }
    };

    const ensureChannel = async () => {
        setEnsuring(true);
        try {
            const result = await adminApi.ensurePiapiChannel();
            message.success(t("admin.piapi.ensureChannelDone", { models: result.modelsCreated, prices: result.pricesInserted }));
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        } finally {
            setEnsuring(false);
        }
    };

    const columns: ColumnsType<AdminPiapiAccount> = [
        { title: t("admin.piapi.account"), dataIndex: "username", ellipsis: true },
        { title: t("admin.piapi.key"), dataIndex: "apiKeyMask", width: 160, render: (value: string) => <span className="font-mono text-xs text-stone-500">{value}</span> },
        { title: t("admin.piapi.status"), dataIndex: "status", width: 100, render: (value: string) => <Tag color={statusColor[value]}>{t(`admin.piapi.statuses.${value}`)}</Tag> },
        { title: t("admin.piapi.balance"), dataIndex: "balanceUsd", width: 110, align: "right", render: (value: string) => `$${Number(value).toFixed(3)}` },
        { title: t("admin.piapi.usedCount"), dataIndex: "usedCount", width: 90, align: "right" },
        { title: t("admin.piapi.checkedAt"), dataIndex: "checkedAt", width: 160, render: (value: string | null) => (value ? new Date(value).toLocaleString() : t("admin.piapi.unchecked")) },
        { title: t("admin.piapi.lastError"), dataIndex: "lastError", ellipsis: true, render: (value: string) => (value ? <span className="text-xs text-red-500">{value}</span> : "-") },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.piapi.title")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{t("admin.piapi.description")}</p>
                </div>
                <div className="flex gap-2">
                    <Button loading={ensuring} icon={<Sparkles className="size-4" />} onClick={() => void ensureChannel()}>
                        {t("admin.piapi.ensureChannel")}
                    </Button>
                    <Button icon={<FileUp className="size-4" />} onClick={() => setImportOpen(true)}>
                        {t("admin.piapi.import")}
                    </Button>
                    <Button loading={refreshing} icon={<RefreshCw className="size-4" />} onClick={() => void refreshAll()} disabled={!accounts.length}>
                        {t("admin.piapi.refresh")}
                    </Button>
                </div>
            </div>

            {selected.length ? (
                <div className="flex items-center gap-2 text-sm text-stone-500">
                    <span>{t("admin.piapi.selected", { count: selected.length })}</span>
                    <Button size="small" onClick={() => void adminApi.setPiapiStatus(selected, "active").then(load)}>
                        {t("admin.piapi.enable")}
                    </Button>
                    <Button size="small" onClick={() => void adminApi.setPiapiStatus(selected, "disabled").then(load)}>
                        {t("admin.piapi.disable")}
                    </Button>
                    <Popconfirm title={t("admin.piapi.deleteConfirm", { count: selected.length })} onConfirm={() => void adminApi.deletePiapi(selected).then(() => { setSelected([]); return load(); })}>
                        <Button size="small" danger icon={<Trash2 className="size-3.5" />}>
                            {t("common.delete")}
                        </Button>
                    </Popconfirm>
                </div>
            ) : null}

            <Table rowKey="id" size="small" loading={loading} dataSource={accounts} columns={columns} rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }} pagination={accounts.length > 20 ? { pageSize: 20 } : false} />

            <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={load} />
        </div>
    );

    function ImportModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => Promise<void> }) {
        const fileRef = useRef<HTMLInputElement>(null);
        const [text, setText] = useState("");
        const [saving, setSaving] = useState(false);

        const submit = async (csv: string) => {
            setSaving(true);
            try {
                const parsed = parsePiapiAccountCsv(csv);
                const result = await adminApi.importPiapi(parsed.accounts);
                message.success(t("admin.piapi.imported", { added: result.added, skipped: result.skipped }));
                setText("");
                await onImported();
                onClose();
            } catch (error) {
                message.error(error instanceof ApiError ? error.message : error instanceof Error ? error.message : t("admin.piapi.importFailed"));
            } finally {
                setSaving(false);
            }
        };

        return (
            <Modal open={open} width={640} title={t("admin.piapi.importTitle")} onCancel={onClose} onOk={() => void submit(text)} okButtonProps={{ disabled: !text.trim() }} confirmLoading={saving} destroyOnHidden>
                <div className="mb-3">
                    <Button icon={<FileUp className="size-4" />} onClick={() => fileRef.current?.click()}>
                        {t("admin.piapi.pickFile")}
                    </Button>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="text/csv,.csv"
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void file.text().then((csv) => submit(csv));
                            event.target.value = "";
                        }}
                    />
                </div>
                <textarea
                    className="h-48 w-full rounded-md border border-stone-200 bg-transparent p-2 font-mono text-xs dark:border-stone-800"
                    value={text}
                    placeholder={t("admin.piapi.csvPlaceholder")}
                    onChange={(event) => setText(event.target.value)}
                />
                <Tooltip title={t("admin.piapi.importHint")}>
                    <p className="mt-2 text-xs text-stone-500">{t("admin.piapi.importHint")}</p>
                </Tooltip>
            </Modal>
        );
    }
}
