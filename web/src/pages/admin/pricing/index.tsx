import { Alert, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { adminApi, type AdminChannel } from "@/services/api/admin";
import { formatMoney } from "@/services/api/models";

type PriceRow = {
    key: string;
    channelName: string;
    apiFormat: string;
    modelName: string;
    capability: string;
    billingMode: string;
    spec: string | null;
    unitPrice: string;
    extraReferencePrice: string;
    minCharge: string;
    enabled: boolean;
};

/**
 * A flat, read-only view of every price in the system. Editing happens on the channels page next to
 * the model it belongs to; this page exists to answer "what do we charge for what" at a glance.
 */
export default function AdminPricingPage() {
    const { t } = useTranslation();
    const [rows, setRows] = useState<PriceRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [missing, setMissing] = useState(0);

    useEffect(() => {
        setLoading(true);
        void adminApi
            .channels()
            .then((channels) => {
                setRows(flatten(channels));
                setMissing(channels.flatMap((channel) => channel.models).filter((model) => !model.prices.length).length);
            })
            .finally(() => setLoading(false));
    }, []);

    const columns: ColumnsType<PriceRow> = [
        { title: t("admin.pricing.channel"), dataIndex: "channelName", ellipsis: true },
        { title: t("admin.pricing.protocol"), dataIndex: "apiFormat", width: 90, render: (value: string) => <Tag>{value}</Tag> },
        { title: t("admin.pricing.model"), dataIndex: "modelName", ellipsis: true },
        { title: t("admin.pricing.capability"), dataIndex: "capability", width: 80, render: (value: string) => t(`settingsPanels.model.capabilities.${value}`) },
        { title: t("admin.pricing.billingMode"), dataIndex: "billingMode", width: 120, render: (value: string) => t(`admin.channels.billing.${value}`) },
        { title: t("admin.pricing.spec"), dataIndex: "spec", width: 100, render: (value: string | null) => value || t("admin.channels.defaultSpec") },
        { title: t("admin.pricing.unitPrice"), dataIndex: "unitPrice", width: 110, align: "right", render: (value: string) => <span className="font-medium">¥{formatMoney(value)}</span> },
        { title: t("admin.pricing.extraReference"), dataIndex: "extraReferencePrice", width: 120, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
        { title: t("admin.pricing.minCharge"), dataIndex: "minCharge", width: 110, align: "right", render: (value: string) => `¥${formatMoney(value)}` },
        { title: t("admin.pricing.enabled"), dataIndex: "enabled", width: 90, render: (value: boolean) => <Tag color={value ? "green" : "default"}>{t(value ? "admin.channels.on" : "admin.channels.off")}</Tag> },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.pricing.title")}</h1>
                <p className="mt-1 text-sm text-stone-500">
                    {t("admin.pricing.description")} <Link to="/admin/channels" className="underline">{t("admin.pricing.editHint")}</Link>
                </p>
            </div>

            {missing ? <Alert type="warning" showIcon message={t("admin.pricing.missingPrices", { count: missing })} description={t("admin.pricing.missingPricesHint")} /> : null}

            <Table rowKey="key" size="small" loading={loading} dataSource={rows} columns={columns} pagination={false} />
        </div>
    );
}

function flatten(channels: AdminChannel[]): PriceRow[] {
    return channels.flatMap((channel) =>
        channel.models.flatMap((model) =>
            model.prices.map((price) => ({
                key: price.id,
                channelName: channel.name,
                apiFormat: channel.apiFormat,
                modelName: model.displayName || model.name,
                capability: model.capability,
                billingMode: price.billingMode,
                spec: price.spec,
                unitPrice: price.unitPrice,
                extraReferencePrice: price.extraReferencePrice,
                minCharge: price.minCharge,
                enabled: channel.enabled && model.enabled,
            })),
        ),
    );
}
