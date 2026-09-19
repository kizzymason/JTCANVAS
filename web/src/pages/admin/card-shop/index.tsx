import { App, Alert, Badge, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Copy, Import, Link2, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import { cardAdminApi, type AdminCardOrder, type AdminCardOrderTotals, type AdminCardProduct, type UpsertCardProductInput } from "@/services/api/card-admin";
import type { CardOrderStatus } from "@/services/api/card-shop";
import { ApiError } from "@/services/api/client";
import { formatMoney } from "@/services/api/models";
import { useAdminTable } from "../use-admin-table";
import { CardDistChannels } from "./dist-channels";
import { CardDistDocs } from "./dist-docs";

const STATUS_COLOR: Record<CardOrderStatus, string> = { paid: "green", pending: "orange", failed: "red", cancelled: "default" };

/** Card shop administration: what is on sale, how it is stocked, and what has been sold. */
export default function AdminCardShopPage() {
    const { t } = useTranslation();
    const [tab, setTab] = useState<"products" | "orders" | "merchants" | "docs">("products");
    const [products, setProducts] = useState<AdminCardProduct[]>([]);

    const loadProducts = useCallback(async () => {
        setProducts((await cardAdminApi.products()).items);
    }, []);

    useEffect(() => {
        void loadProducts().catch(() => undefined);
    }, [loadProducts]);

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.cardShop.title")}</h1>
                <p className="mt-1 text-sm text-stone-500">{t("admin.cardShop.description")}</p>
            </div>

            <ShopLinks />

            <Tabs
                activeKey={tab}
                onChange={(key) => setTab(key as typeof tab)}
                items={[
                    { key: "products", label: t("admin.cardShop.tabProducts"), children: <ProductsTab products={products} reload={loadProducts} /> },
                    { key: "orders", label: t("admin.cardShop.tabOrders"), children: <OrdersTab products={products} /> },
                    { key: "merchants", label: t("admin.cardDist.tabMerchants"), children: <CardDistChannels products={products} /> },
                    { key: "docs", label: t("admin.cardDist.tabDocs"), children: <CardDistDocs /> },
                ]}
            />
        </div>
    );
}

/** The storefront is intentionally unlinked from the site, so the admin page is where the URL lives. */
function ShopLinks() {
    const { t } = useTranslation();
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    return (
        <Alert
            type="info"
            showIcon
            icon={<Link2 className="size-4" />}
            message={t("admin.cardShop.linkTitle")}
            description={
                <div className="flex flex-col gap-1 text-sm">
                    <Typography.Paragraph copyable={{ text: `${origin}/cards` }} className="!mb-0 font-mono text-xs !text-inherit">
                        {`${origin}/cards`}
                    </Typography.Paragraph>
                    <Typography.Paragraph copyable={{ text: `${origin}/cards/orders` }} className="!mb-0 font-mono text-xs !text-inherit">
                        {`${origin}/cards/orders`}
                    </Typography.Paragraph>
                    <span className="opacity-75">{t("admin.cardShop.linkHint")}</span>
                </div>
            }
        />
    );
}

function ProductsTab({ products, reload }: { products: AdminCardProduct[]; reload: () => Promise<void> }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [editing, setEditing] = useState<AdminCardProduct | null>(null);
    const [creating, setCreating] = useState(false);
    const [stocking, setStocking] = useState<{ product: AdminCardProduct; mode: "generate" | "import" } | null>(null);

    const remove = async (product: AdminCardProduct) => {
        try {
            await cardAdminApi.deleteProduct(product.id);
            message.success(t("admin.cardShop.removed"));
            await reload();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        }
    };

    const columns: ColumnsType<AdminCardProduct> = [
        {
            title: t("admin.cardShop.name"),
            dataIndex: "name",
            render: (value: string, row) => (
                <div className="min-w-0">
                    <div className="truncate font-medium">{value}</div>
                    {row.description ? <div className="truncate text-xs text-stone-500">{row.description}</div> : null}
                </div>
            ),
        },
        { title: t("admin.cardShop.faceValue"), dataIndex: "faceValue", width: 110, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
        { title: t("admin.cardShop.salePrice"), dataIndex: "salePrice", width: 110, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
        {
            title: t("admin.cardShop.stock"),
            dataIndex: "stock",
            width: 100,
            align: "right",
            render: (value: number) => <span className={value > 0 ? "tabular-nums" : "tabular-nums text-red-600 dark:text-red-400"}>{value}</span>,
        },
        { title: t("admin.cardShop.sold"), dataIndex: "soldCount", width: 90, align: "right" },
        { title: t("admin.cardShop.perOrderLimit"), dataIndex: "perOrderLimit", width: 110, align: "right" },
        { title: t("admin.cardShop.status"), dataIndex: "enabled", width: 90, render: (value: boolean) => <Tag color={value ? "green" : "default"}>{t(value ? "admin.cardShop.onSale" : "admin.cardShop.offSale")}</Tag> },
        {
            title: t("admin.cardShop.actions"),
            width: 300,
            render: (_value, row) => (
                <Space size={0} wrap>
                    <Button size="small" type="text" onClick={() => setEditing(row)}>
                        {t("common.edit")}
                    </Button>
                    <Button size="small" type="text" icon={<Sparkles className="size-3.5" />} onClick={() => setStocking({ product: row, mode: "generate" })}>
                        {t("admin.cardShop.generate")}
                    </Button>
                    <Button size="small" type="text" icon={<Import className="size-3.5" />} onClick={() => setStocking({ product: row, mode: "import" })}>
                        {t("admin.cardShop.import")}
                    </Button>
                    <Popconfirm title={t("admin.cardShop.removeConfirm")} onConfirm={() => void remove(row)}>
                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <div className="flex flex-col gap-3">
            <div className="flex justify-end">
                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                    {t("admin.cardShop.create")}
                </Button>
            </div>
            <Table rowKey="id" size="small" scroll={{ x: 1100 }} dataSource={products} columns={columns} pagination={false} />

            <ProductModal open={creating} product={null} onClose={() => setCreating(false)} onSaved={reload} />
            <ProductModal open={Boolean(editing)} product={editing} onClose={() => setEditing(null)} onSaved={reload} />
            <StockModal request={stocking} onClose={() => setStocking(null)} onSaved={reload} />
        </div>
    );
}

function ProductModal({ open, product, onClose, onSaved }: { open: boolean; product: AdminCardProduct | null; onClose: () => void; onSaved: () => Promise<void> }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [form] = Form.useForm<UpsertCardProductInput>();
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        form.setFieldsValue({
            name: product?.name ?? "",
            description: product?.description ?? "",
            faceValue: product ? formatMoney(product.faceValue) : "",
            salePrice: product ? formatMoney(product.salePrice) : "",
            perOrderLimit: product?.perOrderLimit ?? 10,
            enabled: product?.enabled ?? true,
            sortOrder: product?.sortOrder ?? 100,
        });
    }, [form, open, product]);

    const submit = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            if (product) await cardAdminApi.updateProduct(product.id, values);
            else await cardAdminApi.createProduct(values);
            message.success(t("admin.saved"));
            await onSaved();
            onClose();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open={open} title={t(product ? "admin.cardShop.editTitle" : "admin.cardShop.create")} onCancel={onClose} onOk={() => void submit()} confirmLoading={saving} okText={t("common.save")} destroyOnHidden>
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item name="name" label={t("admin.cardShop.name")} rules={[{ required: true, max: 128 }]}>
                    <Input placeholder={t("admin.cardShop.namePlaceholder")} />
                </Form.Item>
                <Form.Item name="description" label={t("admin.cardShop.productDescription")}>
                    <Input.TextArea rows={2} maxLength={500} />
                </Form.Item>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Form.Item name="faceValue" label={t("admin.cardShop.faceValue")} extra={t("admin.cardShop.faceValueHint")} rules={[{ required: true }, { pattern: /^\d{1,6}(\.\d{1,2})?$/, message: t("admin.cardShop.amountInvalid") }]}>
                        <Input addonBefore="¥" />
                    </Form.Item>
                    <Form.Item name="salePrice" label={t("admin.cardShop.salePrice")} extra={t("admin.cardShop.salePriceHint")} rules={[{ required: true }, { pattern: /^\d{1,6}(\.\d{1,2})?$/, message: t("admin.cardShop.amountInvalid") }]}>
                        <Input addonBefore="¥" />
                    </Form.Item>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Form.Item name="perOrderLimit" label={t("admin.cardShop.perOrderLimit")} extra={t("admin.cardShop.perOrderLimitHint")}>
                        <InputNumber min={1} max={100} className="w-full" />
                    </Form.Item>
                    <Form.Item name="sortOrder" label={t("admin.cardShop.sortOrder")}>
                        <InputNumber min={0} max={10000} className="w-full" />
                    </Form.Item>
                </div>
                <Form.Item name="enabled" label={t("admin.cardShop.status")} valuePropName="checked" extra={t("admin.cardShop.statusHint")}>
                    <Switch />
                </Form.Item>
            </Form>
        </Modal>
    );
}

/** Stocking a product either mints fresh codes or takes codes the admin already has. */
function StockModal({ request, onClose, onSaved }: { request: { product: AdminCardProduct; mode: "generate" | "import" } | null; onClose: () => void; onSaved: () => Promise<void> }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [form] = Form.useForm<{ quantity?: number; codes?: string; batchName?: string }>();
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!request) return;
        form.setFieldsValue({ quantity: 10, codes: "", batchName: "" });
    }, [form, request]);

    const submit = async () => {
        if (!request) return;
        const values = await form.validateFields();
        setSaving(true);
        try {
            const result =
                request.mode === "generate"
                    ? await cardAdminApi.generate(request.product.id, { quantity: values.quantity ?? 1, batchName: values.batchName })
                    : await cardAdminApi.import(request.product.id, { codes: values.codes ?? "", batchName: values.batchName });
            const skipped = result.skipped ?? 0;
            message.success(skipped ? t("admin.cardShop.stockedWithSkips", { inserted: result.inserted, skipped }) : t("admin.cardShop.stocked", { inserted: result.inserted }));
            await onSaved();
            onClose();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open={Boolean(request)}
            title={t(request?.mode === "import" ? "admin.cardShop.importTitle" : "admin.cardShop.generateTitle", { name: request?.product.name })}
            onCancel={onClose}
            onOk={() => void submit()}
            confirmLoading={saving}
            okText={t("common.save")}
            destroyOnHidden
        >
            <Form form={form} layout="vertical" requiredMark={false}>
                {request?.mode === "generate" ? (
                    <Form.Item name="quantity" label={t("admin.cardShop.quantity")} extra={t("admin.cardShop.quantityHint", { face: formatMoney(request.product.faceValue) })} rules={[{ required: true }]}>
                        <InputNumber min={1} max={5000} className="w-full" />
                    </Form.Item>
                ) : (
                    <Form.Item name="codes" label={t("admin.cardShop.codes")} extra={t("admin.cardShop.codesHint")} rules={[{ required: true }]}>
                        <Input.TextArea rows={8} placeholder={"ABCD-EFGH-IJKL-MNOP\nQRST-UVWX-YZ23-4567"} />
                    </Form.Item>
                )}
                <Form.Item name="batchName" label={t("admin.cardShop.batchName")} extra={t("admin.cardShop.batchNameHint")}>
                    <Input maxLength={128} />
                </Form.Item>
            </Form>
        </Modal>
    );
}

function OrdersTab({ products }: { products: AdminCardProduct[] }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const copy = useCopyText();
    const [keyword, setKeyword] = useState("");
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState<CardOrderStatus | undefined>();
    const [productId, setProductId] = useState<string | undefined>();
    const [totals, setTotals] = useState<AdminCardOrderTotals | null>(null);

    const table = useAdminTable<AdminCardOrder>(
        useCallback((params) => cardAdminApi.orders({ ...params, status, productId, keyword: query || undefined }), [productId, query, status]),
        [productId, query, status],
    );

    useEffect(() => {
        setTotals(table.items[0]?.totals ?? null);
    }, [table.items]);

    const showCodes = async (order: AdminCardOrder) => {
        try {
            const result = await cardAdminApi.orderCodes(order.id);
            Modal.info({
                title: t("admin.cardShop.codesOf", { orderNo: order.orderNo }),
                width: 520,
                content: (
                    <div className="mt-3 flex flex-col gap-1.5">
                        {result.codes.length ? (
                            result.codes.map((code) => (
                                <span key={code} className="break-all font-mono text-xs">
                                    {code}
                                </span>
                            ))
                        ) : (
                            <span className="text-sm text-stone-500">{t("admin.cardShop.noCodes")}</span>
                        )}
                        {result.codes.length ? (
                            <Button className="mt-2 w-fit" size="small" icon={<Copy className="size-3.5" />} onClick={() => copy(result.codes.join("\n"))}>
                                {t("admin.cardShop.copyCodes")}
                            </Button>
                        ) : null}
                    </div>
                ),
            });
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.loadFailed"));
        }
    };

    const columns: ColumnsType<AdminCardOrder> = [
        {
            title: t("admin.cardShop.orderNo"),
            dataIndex: "orderNo",
            width: 210,
            render: (value: string, row) => (
                <div className="min-w-0">
                    <Typography.Text copyable={{ text: value }} className="font-mono text-xs">
                        {value}
                    </Typography.Text>
                    <div className="truncate text-xs text-stone-500">{row.email}</div>
                </div>
            ),
        },
        { title: t("admin.cardShop.product"), dataIndex: "productName", ellipsis: true },
        { title: t("admin.cardShop.quantityShort"), dataIndex: "quantity", width: 80, align: "right" },
        { title: t("admin.cardShop.amount"), dataIndex: "amount", width: 110, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
        {
            title: t("admin.cardShop.status"),
            dataIndex: "status",
            width: 130,
            render: (value: CardOrderStatus, row) => (
                <Space size={4}>
                    <Tag color={STATUS_COLOR[value]}>{t(`cardShop.statuses.${value}`)}</Tag>
                    {value === "paid" && row.deliveredCount < row.quantity ? <Badge status="warning" text={`${row.deliveredCount}/${row.quantity}`} /> : null}
                </Space>
            ),
        },
        { title: t("admin.cardShop.paidAt"), dataIndex: "paidAt", width: 160, render: (value: string | null) => (value ? new Date(value).toLocaleString() : "-") },
        { title: t("admin.cardShop.clientIp"), dataIndex: "clientIp", width: 130, ellipsis: true, render: (value: string) => value || "-" },
        {
            title: t("admin.cardShop.actions"),
            width: 110,
            render: (_value, row) => (
                <Button size="small" type="text" disabled={row.status !== "paid"} onClick={() => void showCodes(row)}>
                    {t("admin.cardShop.viewCodes")}
                </Button>
            ),
        },
    ];

    return (
        <div className="flex flex-col gap-3">
            {totals ? (
                <div className="flex flex-wrap gap-4 text-sm">
                    <span className="text-stone-500">
                        {t("admin.cardShop.totalPaid")}
                        <span className="ml-1.5 font-semibold tabular-nums text-stone-950 dark:text-stone-100">{totals.paidOrders}</span>
                    </span>
                    <span className="text-stone-500">
                        {t("admin.cardShop.totalRevenue")}
                        <span className="ml-1.5 font-semibold tabular-nums text-stone-950 dark:text-stone-100">{`¥${formatMoney(totals.revenue)}`}</span>
                    </span>
                    {totals.undelivered > 0 ? <Tag color="orange">{t("admin.cardShop.undelivered", { count: totals.undelivered })}</Tag> : null}
                </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
                <Space.Compact className="max-w-sm">
                    <Input
                        value={keyword}
                        placeholder={t("admin.cardShop.searchPlaceholder")}
                        allowClear
                        onChange={(event) => setKeyword(event.target.value)}
                        onPressEnter={() => {
                            table.setPage(1);
                            setQuery(keyword.trim());
                        }}
                    />
                    <Button
                        icon={<Search className="size-4" />}
                        onClick={() => {
                            table.setPage(1);
                            setQuery(keyword.trim());
                        }}
                    />
                </Space.Compact>
                <Select
                    allowClear
                    style={{ width: 140 }}
                    placeholder={t("admin.cardShop.status")}
                    value={status}
                    onChange={(value) => {
                        table.setPage(1);
                        setStatus(value);
                    }}
                    options={(["paid", "pending", "failed", "cancelled"] as CardOrderStatus[]).map((value) => ({ value, label: t(`cardShop.statuses.${value}`) }))}
                />
                <Select
                    allowClear
                    style={{ width: 200 }}
                    placeholder={t("admin.cardShop.product")}
                    value={productId}
                    onChange={(value) => {
                        table.setPage(1);
                        setProductId(value);
                    }}
                    options={products.map((item) => ({ value: item.id, label: item.name }))}
                />
            </div>

            <Table rowKey="id" size="small" scroll={{ x: 1150 }} loading={table.loading} dataSource={table.items} columns={columns} pagination={table.pagination} />
        </div>
    );
}
