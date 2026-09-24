import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag } from "antd";
import { homepageApi, type HomeConfig, type HomeWork, type HomeWorkInput } from "@/services/api/homepage";
import { MediaField } from "./components/media-field";

const emptyConfig: HomeConfig = {
    hero: { title: "让想象，成为作品。", subtitle: "图像、视频与无限画布，一站式 AI 创作。", visible: true, media: null },
    entries: [{ kind: "image", title: "图片生成", description: "用 AI 生成惊艳的图像", visible: true, media: null }, { kind: "video", title: "视频生成", description: "让画面动起来", visible: true, media: null }, { kind: "canvas", title: "无限画布", description: "在无边界中自由创作", visible: true, media: null }],
};
const inputOf = (work: HomeWork): HomeWorkInput => ({ title: work.title, category: work.category, kind: work.kind, prompt: work.prompt, media: work.media, poster: work.poster, published: work.published, sortOrder: work.sortOrder });

export default function HomepageAdminPage() {
    const { message, modal } = App.useApp();
    const [configForm] = Form.useForm<HomeConfig>();
    const [workForm] = Form.useForm<HomeWorkInput>();
    const [works, setWorks] = useState<HomeWork[]>([]);
    const [initialized, setInitialized] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editor, setEditor] = useState<{ id?: string } | null>(null);
    const kind = Form.useWatch("kind", workForm);
    const load = useCallback(async () => {
        setLoading(true);
        try { const data = await homepageApi.admin(); setWorks(data.works); setInitialized(data.initialized); configForm.setFieldsValue(data.config || emptyConfig); }
        catch (e) { message.error(e instanceof Error ? e.message : "读取失败"); }
        finally { setLoading(false); }
    }, [configForm, message]);
    useEffect(() => { void load(); }, [load]);
    const mutate = async (action: () => Promise<unknown>) => {
        setSaving(true);
        try { await action(); message.success("已保存"); await load(); return true; }
        catch (e) { message.error(e instanceof Error ? e.message : "操作失败"); return false; }
        finally { setSaving(false); }
    };
    const edit = (work?: HomeWork) => {
        workForm.resetFields();
        workForm.setFieldsValue(work ? inputOf(work) : { title: "", category: "影像", kind: "image", prompt: "", published: false, sortOrder: 0, poster: null });
        setEditor({ id: work?.id });
    };
    return <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">首页管理</h1><p className="mt-1 text-sm text-stone-500">管理品牌横幅、创作入口与精选作品。</p></div><Space><Button onClick={() => void load()} loading={loading}>刷新</Button><Button href="/" target="_blank">查看首页</Button><Button disabled={initialized || loading || saving} onClick={() => modal.confirm({ title: "载入品牌示例", content: "将发布巨鲸横幅、三个入口和四张精选示例。仅空配置可执行，不覆盖现有内容。", onOk: async () => { if (!await mutate(homepageApi.initialize)) throw new Error("初始化失败"); } })}>载入品牌示例</Button></Space></div>
        <Alert type="warning" showIcon title="公开展示内容" description="启用的品牌图片、已发布作品及提示词将向所有访客公开。作品首次保存为草稿，检查后再发布。" />
        <Tabs items={[
            { key: "brand", label: "品牌与入口", children: <Form form={configForm} layout="vertical" onFinish={(values) => void mutate(() => homepageApi.save(values))}>
                <Card title="品牌横幅" className="mb-4"><Form.Item name={["hero", "visible"]} label="显示横幅" valuePropName="checked"><Switch /></Form.Item><Form.Item name={["hero", "title"]} label="主标题（可换行）" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item><Form.Item name={["hero", "subtitle"]} label="副标题"><Input /></Form.Item><Form.Item name={["hero", "media"]} label="横幅图片"><MediaField /></Form.Item></Card>
                <Form.List name="entries">{(fields) => <div className="grid gap-4 xl:grid-cols-3">{fields.map((field, index) => <Card key={field.key} title={["图片生成入口", "视频生成入口", "画布入口"][index]}><Form.Item name={[field.name, "kind"]} hidden><Input /></Form.Item><Form.Item name={[field.name, "visible"]} label="显示入口" valuePropName="checked"><Switch /></Form.Item><Form.Item name={[field.name, "title"]} label="标题" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name={[field.name, "description"]} label="描述"><Input /></Form.Item><Form.Item name={[field.name, "media"]} label="入口图片"><MediaField /></Form.Item></Card>)}</div>}</Form.List>
                <Button className="mt-5" type="primary" htmlType="submit" loading={saving} disabled={loading}>保存品牌配置</Button>
            </Form> },
            { key: "works", label: "精选作品", children: <div className="space-y-4"><Button type="primary" onClick={() => edit()}>新增作品</Button><Table rowKey="id" dataSource={works} loading={loading} scroll={{ x: 800 }} columns={[
                { title: "排序", dataIndex: "sortOrder", width: 80 }, { title: "作品", dataIndex: "title" }, { title: "分类", dataIndex: "category" }, { title: "类型", dataIndex: "kind", render: (v: string) => v === "image" ? "图片" : "视频" }, { title: "状态", dataIndex: "published", render: (v: boolean) => <Tag color={v ? "green" : undefined}>{v ? "已发布" : "草稿"}</Tag> },
                { title: "操作", render: (_, work) => <Space><Button type="link" onClick={() => edit(work)}>编辑</Button><Button type="link" disabled={saving} onClick={() => void mutate(() => homepageApi.saveWork(work.id, { ...inputOf(work), published: !work.published }))}>{work.published ? "下架" : "发布"}</Button><Button danger type="link" disabled={saving} onClick={() => modal.confirm({ title: "删除作品", content: `删除「${work.title}」？首页将不再展示它。`, okButtonProps: { danger: true }, onOk: async () => { if (!await mutate(() => homepageApi.remove(work.id))) throw new Error("删除失败"); } })}>删除</Button></Space> },
            ]} /></div> },
        ]} />
        <Modal open={!!editor} title={editor?.id ? "编辑作品" : "新增作品草稿"} width={760} onCancel={() => setEditor(null)} confirmLoading={saving} onOk={() => workForm.submit()} forceRender>
            <Form form={workForm} layout="vertical" onFinish={async (values) => { if (await mutate(() => homepageApi.saveWork(editor?.id, { ...values, poster: values.poster ?? null }))) setEditor(null); }}>
                <div className="grid grid-cols-2 gap-x-4"><Form.Item name="title" label="作品名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="category" label="分类" rules={[{ required: true }]}><Input placeholder="例如：人像、建筑、自然" /></Form.Item><Form.Item name="kind" label="作品类型" rules={[{ required: true }]}><Select options={[{ value: "image", label: "图片" }, { value: "video", label: "视频" }]} onChange={() => { workForm.setFieldValue("media", null); workForm.setFieldValue("poster", null); }} /></Form.Item><Form.Item name="sortOrder" label="排序（越小越靠前）"><InputNumber precision={0} /></Form.Item></div>
                <Form.Item name="media" label="作品媒体" rules={[{ required: true }]}><MediaField video={kind === "video"} allowBrand={kind !== "video"} /></Form.Item>
                {kind === "video" ? <Form.Item name="poster" label="视频封面" rules={[{ required: true }]}><MediaField /></Form.Item> : null}
                <Form.Item name="prompt" label="公开提示词" extra="访客可查看并带入对应工作台。留空时不提供同款创作。"><Input.TextArea rows={4} /></Form.Item>
                <Form.Item name="published" label="发布" valuePropName="checked"><Switch disabled={!editor?.id} /></Form.Item>
            </Form>
        </Modal>
    </div>;
}
