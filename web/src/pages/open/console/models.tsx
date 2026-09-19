import { Alert, Input, Segmented, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import Decimal from "decimal.js";
import { BookOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ModelBrandIcon } from "@/components/model-brand-icon";
import { ApiError } from "@/services/api/client";
import { formatMoney } from "@/services/api/models";
import { resellerApi, type ResellerModel } from "@/services/api/reseller";

/** Renders the surcharge the way the admin configured it, rather than the internal coefficient. */
function surchargeLabel(multiplier: string) {
    try {
        const surcharge = new Decimal(multiplier).minus(1).times(100);
        if (surcharge.isZero()) return "0%";
        return `${surcharge.isPositive() ? "+" : ""}${surcharge.toDecimalPlaces(2).toString()}%`;
    } catch {
        return "0%";
    }
}

function unitSuffixKey(billingMode: ResellerModel["billingMode"]) {
    if (billingMode === "per_image") return "openPlatform.models.perImage";
    if (billingMode === "per_second") return "openPlatform.models.perSecond";
    if (billingMode === "per_token") return "openPlatform.models.perMillionTokens";
    return "openPlatform.models.perCall";
}

export default function OpenConsoleModelsPage() {
    const { t } = useTranslation();
    const [models, setModels] = useState<ResellerModel[]>([]);
    const [multiplier, setMultiplier] = useState("1");
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [capability, setCapability] = useState<"all" | ResellerModel["capability"]>("all");
    const [keyword, setKeyword] = useState("");

    useEffect(() => {
        void resellerApi
            .models()
            .then((result) => {
                setModels(result.models);
                setMultiplier(result.multiplier);
                setLoadError("");
            })
            .catch((error) => setLoadError(error instanceof ApiError ? error.message : t("openPlatform.models.loadFailed")))
            .finally(() => setLoading(false));
    }, [t]);

    const filtered = useMemo(() => {
        const needle = keyword.trim().toLowerCase();
        return models.filter((model) => {
            if (capability !== "all" && model.capability !== capability) return false;
            if (!needle) return true;
            return model.id.toLowerCase().includes(needle) || model.displayName.toLowerCase().includes(needle);
        });
    }, [capability, keyword, models]);

    const columns: ColumnsType<ResellerModel> = [
        {
            title: t("openPlatform.models.modelId"),
            dataIndex: "id",
            render: (value: string, model) => (
                <div className="flex min-w-0 items-center gap-2.5">
                    <ModelBrandIcon model={value} className="size-5" />
                    <div className="min-w-0">
                        <Typography.Text copyable={{ text: value }} className="font-mono text-xs">
                            {value}
                        </Typography.Text>
                        <div className="truncate text-xs text-stone-500">{model.displayName}</div>
                    </div>
                </div>
            ),
        },
        {
            title: t("openPlatform.models.capability"),
            dataIndex: "capability",
            width: 90,
            render: (value: string) => <Tag>{t(`settingsPanels.model.capabilities.${value}`, { defaultValue: value })}</Tag>,
        },
        {
            title: t("openPlatform.models.billingMode"),
            dataIndex: "billingMode",
            width: 120,
            render: (value: ResellerModel["billingMode"]) => t(`openPlatform.models.billingModes.${value}`),
        },
        {
            title: t("openPlatform.models.yourPrice"),
            width: 200,
            align: "right",
            render: (_value, model) =>
                model.billingMode === "per_token" ? (
                    <div className="text-xs tabular-nums">
                        <div>{t("openPlatform.models.inputPrice", { price: formatMoney(model.tokenPrices.input) })}</div>
                        <div>{t("openPlatform.models.outputPrice", { price: formatMoney(model.tokenPrices.output) })}</div>
                    </div>
                ) : (
                    <span className="tabular-nums">
                        {`¥${formatMoney(model.unitPrice)}`}
                        <span className="text-stone-500">{t(unitSuffixKey(model.billingMode))}</span>
                    </span>
                ),
        },
        {
            title: t("openPlatform.models.listPrice"),
            dataIndex: "listUnitPrice",
            width: 120,
            align: "right",
            render: (value: string, model) => (model.billingMode === "per_token" ? "-" : <span className="tabular-nums text-stone-500">{`¥${formatMoney(value)}`}</span>),
        },
        {
            title: t("openPlatform.models.specs"),
            width: 210,
            render: (_value, model) => {
                const entries = Object.entries(model.specPrices).filter(([spec]) => spec !== "input" && spec !== "output");
                if (!entries.length) return <span className="text-xs text-stone-500">-</span>;
                return (
                    <Space size={[4, 4]} wrap>
                        {entries.map(([spec, price]) => (
                            <Tooltip key={spec} title={`${spec}: ¥${formatMoney(price)}`}>
                                <Tag className="font-mono text-[11px]">{`${spec} ¥${formatMoney(price)}`}</Tag>
                            </Tooltip>
                        ))}
                    </Space>
                );
            },
        },
        {
            title: t("openPlatform.models.usage"),
            width: 220,
            render: (_value, model) => <span className="text-xs text-stone-500">{t(`openPlatform.models.usageHints.${model.capability}`, { defaultValue: "" })}</span>,
        },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("openPlatform.models.title")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{t("openPlatform.models.description")}</p>
                </div>
                <Link to="/open/console/docs" className="inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-950 dark:text-stone-300 dark:hover:text-stone-100">
                    <BookOpen className="size-4" />
                    {t("openPlatform.models.viewDocs")}
                </Link>
            </div>

            {loadError ? <Alert type="error" showIcon message={loadError} /> : null}

            <Alert type="info" showIcon message={t("openPlatform.models.multiplierNotice", { surcharge: surchargeLabel(multiplier) })} description={t("openPlatform.models.multiplierHint")} />

            <div className="flex flex-wrap items-center gap-2">
                <Segmented
                    value={capability}
                    onChange={(value) => setCapability(value as typeof capability)}
                    options={[
                        { value: "all", label: t("common.all") },
                        { value: "image", label: t("settingsPanels.model.capabilities.image") },
                        { value: "video", label: t("settingsPanels.model.capabilities.video") },
                        { value: "text", label: t("settingsPanels.model.capabilities.text") },
                    ]}
                />
                <Input.Search allowClear className="max-w-xs" placeholder={t("openPlatform.models.searchPlaceholder")} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            </div>

            <Table rowKey="qualifiedId" size="small" scroll={{ x: 1200 }} loading={loading} dataSource={filtered} columns={columns} pagination={{ pageSize: 20, showSizeChanger: false }} />
        </div>
    );
}
