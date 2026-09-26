import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError } from "@/services/api/client";
import {
    adminModelCatalogApi,
    type AdminModelCatalog,
    type AdminModelEntry,
    type AdminModelGroup,
    type ModelBadge,
    type ModelEntryWrite,
    type ModelGroupWrite,
} from "@/services/api/model-catalog";
import { useModelStore } from "@/stores/use-model-store";

const TONES: Array<{ value: string; label: string }> = [
    { value: "primary", label: "强调（荧光绿）" },
    { value: "warning", label: "提醒（橙色）" },
    { value: "neutral", label: "普通（灰色）" },
];

const toneColor: Record<string, string> = { primary: "lime", warning: "orange", neutral: "default" };

/**
 * 「模型介绍」：维护工作台模型选择弹窗里的分组、每个模型的介绍文案与标识（最新 / 推荐…）。
 * 展示信息与渠道配置分开存放，渠道里换模型不会影响这里已经写好的介绍。
 */
export default function AdminModelCatalogPage() {
    const { message } = App.useApp();
    const models = useModelStore((state) => state.models);
    const loadModels = useModelStore((state) => state.load);
    const [data, setData] = useState<AdminModelCatalog | null>(null);
    const [loading, setLoading] = useState(false);
    const [groupForm] = Form.useForm<ModelGroupWrite>();
    const [entryForm] = Form.useForm<ModelEntryWrite & { badges?: ModelBadge[] }>();
    const [editingGroup, setEditingGroup] = useState<AdminModelGroup | "new" | null>(null);
    const [editingEntry, setEditingEntry] = useState<AdminModelEntry | "new" | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            setData(await adminModelCatalogApi.get());
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : "模型介绍加载失败");
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => { void reload(); void loadModels(); }, [reload, loadModels]);

    const modelLabel = useMemo(() => {
        const map = new Map(models.map((item) => [item.value, item.displayName]));
        return (value: string) => map.get(value) || value;
    }, [models]);
    const groupName = (id: string | null | undefined) => data?.groups.find((item) => item.id === id)?.name || "未分组";

    const saveGroup = async () => {
        const values = await groupForm.validateFields();
        try {
            if (editingGroup === "new") await adminModelCatalogApi.createGroup(values);
            else if (editingGroup) await adminModelCatalogApi.updateGroup(editingGroup.id, values);
            message.success("分组已保存");
            setEditingGroup(null);
            await reload();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : "保存失败");
        }
    };

    const removeGroup = async (row: AdminModelGroup) => {
        try {
            const result = await adminModelCatalogApi.removeGroup(row.id);
            message.success(result.ungrouped ? `分组已删除，${result.ungrouped} 个模型变成未分组` : "分组已删除");
            await reload();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : "删除失败");
        }
    };

    const saveEntry = async () => {
        const values = await entryForm.validateFields();
        const payload: ModelEntryWrite = {
            modelValue: values.modelValue,
            groupId: values.groupId || null,
            summary: values.summary || "",
            description: values.description || "",
            badges: (values.badges || []).filter((badge) => badge?.label?.trim()).map((badge) => ({ key: badge.key || badge.label, label: badge.label, tone: badge.tone || "primary" })),
            sortOrder: values.sortOrder ?? 100,
            visible: values.visible ?? true,
        };
        try {
            if (editingEntry === "new") await adminModelCatalogApi.createEntry(payload);
            else if (editingEntry) await adminModelCatalogApi.updateEntry(editingEntry.id, payload);
            message.success("模型介绍已保存");
            setEditingEntry(null);
            await reload();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : "保存失败");
        }
    };

    const removeEntry = async (row: AdminModelEntry) => {
        try {
            await adminModelCatalogApi.removeEntry(row.id);
            message.success("已删除");
            await reload();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : "删除失败");
        }
    };

    const groupColumns: ColumnsType<AdminModelGroup> = [
        { title: "分组名称", dataIndex: "name" },
        { title: "标识 key", dataIndex: "key", render: (value: string) => <Tag>{value}</Tag> },
        { title: "说明", dataIndex: "description", ellipsis: true },
        { title: "模型数", width: 90, render: (_, row) => data?.models.filter((item) => item.groupId === row.id).length ?? 0 },
        { title: "排序", dataIndex: "sortOrder", width: 80 },
        { title: "前台显示", dataIndex: "visible", width: 100, render: (value: boolean) => (value ? <Tag color="green">显示</Tag> : <Tag>隐藏</Tag>) },
        {
            title: "操作",
            width: 130,
            render: (_, row) => (
                <Space>
                    <Tooltip title="编辑">
                        <Button size="small" icon={<Pencil size={14} />} onClick={() => setEditingGroup(row)} />
                    </Tooltip>
                    <Popconfirm title="删除分组？组内模型会变成未分组" onConfirm={() => void removeGroup(row)}>
                        <Button size="small" danger icon={<Trash2 size={14} />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    const entryColumns: ColumnsType<AdminModelEntry> = [
        {
            title: "模型",
            dataIndex: "modelValue",
            render: (value: string) => (
                <div className="min-w-0">
                    <div className="truncate font-medium">{modelLabel(value)}</div>
                    <div className="truncate text-xs text-muted-foreground">{value}</div>
                </div>
            ),
        },
        { title: "分组", width: 120, render: (_, row) => groupName(row.groupId) },
        {
            title: "标识",
            width: 180,
            render: (_, row) => (row.badges?.length ? <Space size={4} wrap>{row.badges.map((badge) => <Tag key={`${badge.key}-${badge.label}`} color={toneColor[badge.tone || "primary"]}>{badge.label}</Tag>)}</Space> : <span className="text-muted-foreground">—</span>),
        },
        { title: "简介", dataIndex: "summary", ellipsis: true },
        { title: "排序", dataIndex: "sortOrder", width: 70 },
        { title: "前台显示", dataIndex: "visible", width: 100, render: (value: boolean) => (value ? <Tag color="green">显示</Tag> : <Tag>隐藏</Tag>) },
        {
            title: "操作",
            width: 130,
            render: (_, row) => (
                <Space>
                    <Tooltip title="编辑介绍与标识">
                        <Button size="small" icon={<Pencil size={14} />} onClick={() => setEditingEntry(row)} />
                    </Tooltip>
                    <Popconfirm title="删除这条模型介绍？" onConfirm={() => void removeEntry(row)}>
                        <Button size="small" danger icon={<Trash2 size={14} />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <div className="flex flex-col gap-6">
            <section>
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <h3 className="text-base font-semibold">模型分组</h3>
                        <p className="text-xs text-muted-foreground">工作台模型选择弹窗左侧的分类，可增删与排序，隐藏后前台不显示。</p>
                    </div>
                    <Button type="primary" icon={<Plus size={14} />} onClick={() => setEditingGroup("new")}>新增分组</Button>
                </div>
                <Table<AdminModelGroup> rowKey="id" size="small" loading={loading} columns={groupColumns} dataSource={data?.groups ?? []} pagination={false} />
            </section>

            <section>
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <h3 className="text-base font-semibold">模型介绍与标识</h3>
                        <p className="text-xs text-muted-foreground">每个模型可以写简介与详细介绍，并加上「最新 / 推荐」等标识；这些内容显示在模型选择弹窗里。</p>
                    </div>
                    <Button type="primary" icon={<Plus size={14} />} onClick={() => setEditingEntry("new")}>新增模型介绍</Button>
                </div>
                <Table<AdminModelEntry> rowKey="id" size="small" loading={loading} columns={entryColumns} dataSource={data?.models ?? []} pagination={false} />
            </section>

            <Modal open={editingGroup !== null} title={editingGroup === "new" ? "新增分组" : "编辑分组"} onCancel={() => setEditingGroup(null)} onOk={() => void saveGroup()} destroyOnClose>
                <Form form={groupForm} layout="vertical" preserve={false}
                    initialValues={editingGroup && editingGroup !== "new" ? { key: editingGroup.key, name: editingGroup.name, description: editingGroup.description, sortOrder: editingGroup.sortOrder, visible: editingGroup.visible } : { sortOrder: 100, visible: true }}>
                    <Form.Item name="name" label="分组名称" rules={[{ required: true, message: "请填写分组名称" }]}><Input placeholder="例如：推荐模型" /></Form.Item>
                    <Form.Item name="key" label="标识 key" rules={[{ required: true, message: "请填写 key" }]} extra="代码里引用用，建议英文小写，例如 featured"><Input placeholder="featured" /></Form.Item>
                    <Form.Item name="description" label="说明"><Input placeholder="给管理员看的备注" /></Form.Item>
                    <Space size={24}>
                        <Form.Item name="sortOrder" label="排序"><InputNumber min={0} /></Form.Item>
                        <Form.Item name="visible" label="前台显示" valuePropName="checked"><Switch /></Form.Item>
                    </Space>
                </Form>
            </Modal>

            <Modal open={editingEntry !== null} title={editingEntry === "new" ? "新增模型介绍" : "编辑模型介绍"} width={640} onCancel={() => setEditingEntry(null)} onOk={() => void saveEntry()} destroyOnClose>
                <Form form={entryForm} layout="vertical" preserve={false}
                    initialValues={editingEntry && editingEntry !== "new"
                        ? { modelValue: editingEntry.modelValue, groupId: editingEntry.groupId, summary: editingEntry.summary, description: editingEntry.description, badges: editingEntry.badges, sortOrder: editingEntry.sortOrder, visible: editingEntry.visible }
                        : { badges: [], sortOrder: 100, visible: true }}>
                    <Form.Item name="modelValue" label="模型" rules={[{ required: true, message: "请选择或填写模型值" }]} extra="格式为 渠道ID::模型名，与渠道里配置的模型值一致">
                        <Select showSearch placeholder="选择模型，或直接输入模型值"
                            options={models.map((item) => ({ value: item.value, label: `${item.displayName}（${item.value}）` }))} />
                    </Form.Item>
                    <Form.Item name="groupId" label="所属分组"><Select allowClear placeholder="不选则为未分组" options={(data?.groups ?? []).map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
                    <Form.Item name="summary" label="一句话简介"><Input placeholder="例如：旗舰图形模型，直出 4K" /></Form.Item>
                    <Form.Item name="description" label="详细介绍"><Input.TextArea rows={5} placeholder="支持换行。可以写能力范围、适用场景与使用建议。" /></Form.Item>
                    <Form.Item label="标识（最新 / 推荐…）">
                        <Form.List name="badges">
                            {(fields, { add, remove }) => (
                                <div className="flex flex-col gap-2">
                                    {fields.map((field) => (
                                        <Space key={field.key} align="baseline">
                                            <Form.Item name={[field.name, "label"]} noStyle><Input placeholder="标识文字" style={{ width: 140 }} /></Form.Item>
                                            <Form.Item name={[field.name, "tone"]} noStyle><Select style={{ width: 150 }} options={TONES} placeholder="样式" /></Form.Item>
                                            <Button size="small" type="text" danger onClick={() => remove(field.name)}>移除</Button>
                                        </Space>
                                    ))}
                                    <Space wrap>
                                        <Button size="small" icon={<Plus size={14} />} onClick={() => add({ key: "", label: "", tone: "primary" })}>添加标识</Button>
                                        {(data?.badgePresets ?? []).map((preset) => (
                                            <Tag key={preset.key} className="cursor-pointer" color={toneColor[preset.tone || "primary"]} onClick={() => add(preset)}>+ {preset.label}</Tag>
                                        ))}
                                    </Space>
                                </div>
                            )}
                        </Form.List>
                    </Form.Item>
                    <Space size={24}>
                        <Form.Item name="sortOrder" label="排序"><InputNumber min={0} /></Form.Item>
                        <Form.Item name="visible" label="前台显示" valuePropName="checked"><Switch /></Form.Item>
                    </Space>
                </Form>
            </Modal>
        </div>
    );
}
