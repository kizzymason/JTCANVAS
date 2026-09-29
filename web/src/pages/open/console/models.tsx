import { Alert, Drawer, Empty, Input, Segmented, Skeleton, Space, Tag, Typography } from "antd";
import Decimal from "decimal.js";
import { BookOpen, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ModelBrandIcon } from "@/components/model-brand-icon";
import { ApiError } from "@/services/api/client";
import { formatMoney } from "@/services/api/models";
import { resellerApi, type ResellerModel } from "@/services/api/reseller";

/** Wide enough for the token tier tables without pushing the list off screen. */
const MODEL_DRAWER_SIZE = "min(max(52vw, 460px), 720px, 100%)";

type TokenRate = { maxInputTokens?: number; input: string; output: string; cacheRead?: string; cacheWrite?: string };

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

function positiveAmount(amount: string | undefined) {
    if (!amount) return false;
    try {
        return new Decimal(amount).greaterThan(0);
    } catch {
        return false;
    }
}

/** Spec tiers that carry their own price, i.e. everything except the token-rate bookkeeping keys. */
function specEntries(model: ResellerModel) {
    return Object.entries(model.specPrices ?? {}).filter(([spec]) => !spec.startsWith("tokens:") && spec !== "input" && spec !== "output");
}

function tokenRates(model: ResellerModel): TokenRate[] {
    const tiers = model.tokenPrices?.tiers;
    if (tiers && tiers.length) return tiers;
    return [
        {
            input: model.tokenPrices?.input ?? "0",
            output: model.tokenPrices?.output ?? "0",
            cacheRead: model.tokenPrices?.cacheRead,
            cacheWrite: model.tokenPrices?.cacheWrite,
        },
    ];
}

/** The price headline: one number for unit billing, an input/output pair for token billing. */
function PriceHeadline({ model, className }: { model: ResellerModel; className?: string }) {
    const { t } = useTranslation();
    if (model.billingMode === "per_token") {
        return (
            <span className={`tabular-nums ${className ?? ""}`}>
                {t("openPlatform.models.inputPrice", { price: formatMoney(model.tokenPrices?.input ?? "0") })}
                <span className="px-1 text-stone-400">·</span>
                {t("openPlatform.models.outputPrice", { price: formatMoney(model.tokenPrices?.output ?? "0") })}
            </span>
        );
    }
    return (
        <span className={`tabular-nums font-medium ${className ?? ""}`}>
            {`¥${formatMoney(model.unitPrice)}`}
            <span className="font-normal text-stone-500">{t(unitSuffixKey(model.billingMode))}</span>
        </span>
    );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-stone-100 py-2 last:border-b-0 dark:border-stone-800">
            <span className="w-28 shrink-0 text-xs text-stone-500">{label}</span>
            <span className="min-w-0 flex-1 text-sm text-stone-800 dark:text-stone-200">{children}</span>
        </div>
    );
}

function DrawerSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
    return (
        <section className="rounded-xl border border-stone-200 bg-white px-4 py-2 dark:border-stone-800 dark:bg-stone-900">
            <div className="flex items-baseline justify-between gap-3 pt-3 pb-1">
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{title}</h3>
                {hint ? <span className="text-xs text-stone-500">{hint}</span> : null}
            </div>
            {children}
        </section>
    );
}

/** Dimensions the model actually supports, e.g. resolutions, ratios, duration range. */
function ConfigRows({ model }: { model: ResellerModel }) {
    const { t } = useTranslation();
    const features = model.features;
    const rows: Array<{ label: string; value: ReactNode }> = [];

    const resolutions = features?.resolutions ?? [];
    const videoResolutions = features?.videoResolutions ?? [];
    if (model.capability === "video") {
        if (videoResolutions.length) {
            rows.push({
                label: t("openPlatform.models.config.resolutions"),
                value: <span className="font-mono text-xs">{videoResolutions.map((value) => `${value}p`).join(" / ")}</span>,
            });
        }
        if (features) {
            rows.push({
                label: t("openPlatform.models.config.duration"),
                value: t("openPlatform.models.config.durationValue", { min: features.minSeconds ?? 0, max: features.maxSeconds }),
            });
        }
        if (features) {
            rows.push({
                label: t("openPlatform.models.config.videoCount"),
                value: t("openPlatform.models.config.videoCountValue", { count: features.maxCount }),
            });
        }
    } else if (model.capability === "image") {
        if (resolutions.length) {
            rows.push({
                label: t("openPlatform.models.config.resolutions"),
                value: <span className="font-mono text-xs">{resolutions.join(" / ")}</span>,
            });
        }
        const ratios = features?.aspectRatios ?? [];
        if (ratios.length) {
            rows.push({
                label: t("openPlatform.models.config.aspectRatios"),
                value: (
                    <Space size={[4, 4]} wrap>
                        {ratios.map((ratio) => (
                            <Tag key={ratio} className="font-mono text-[11px]">
                                {ratio}
                            </Tag>
                        ))}
                    </Space>
                ),
            });
        }
        if (features) {
            rows.push({
                label: t("openPlatform.models.config.maxCount"),
                value: t("openPlatform.models.config.maxCountValue", { count: features.maxCount }),
            });
            rows.push({
                label: t("openPlatform.models.config.transparent"),
                value: features.supportsTransparent ? t("openPlatform.models.config.supported") : t("openPlatform.models.config.unsupported"),
            });
        }
    }

    if (!rows.length) {
        return <p className="py-2 text-xs text-stone-500">{t("openPlatform.models.config.none")}</p>;
    }

    return (
        <div className="pb-1">
            {rows.map((row) => (
                <Row key={row.label} label={row.label}>
                    {row.value}
                </Row>
            ))}
        </div>
    );
}

function CostRows({ model }: { model: ResellerModel }) {
    const { t } = useTranslation();
    const specs = specEntries(model);

    return (
        <div className="pb-1">
            <Row label={t("openPlatform.models.billingMode")}>{t(`openPlatform.models.billingModes.${model.billingMode}`)}</Row>
            <Row label={t("openPlatform.models.yourPrice")}>
                <PriceHeadline model={model} className="text-base text-stone-900 dark:text-stone-100" />
            </Row>
            {model.billingMode !== "per_token" && (
                <Row label={t("openPlatform.models.listPrice")}>
                    <span className="tabular-nums text-stone-500">{`¥${formatMoney(model.listUnitPrice)}${t(unitSuffixKey(model.billingMode))}`}</span>
                </Row>
            )}
            {positiveAmount(model.minCharge) && (
                <Row label={t("openPlatform.models.cost.minCharge")}>
                    <span className="tabular-nums">{`¥${formatMoney(model.minCharge)}`}</span>
                </Row>
            )}
            {positiveAmount(model.extraReferencePrice) && (
                <Row label={t("openPlatform.models.cost.referencePrice")}>
                    <span className="tabular-nums">{`¥${formatMoney(model.extraReferencePrice)}${t("openPlatform.models.perImage")}`}</span>
                </Row>
            )}
            {specs.length > 0 && (
                <Row label={t("openPlatform.models.specs")}>
                    <Space size={[4, 4]} wrap>
                        {specs.map(([spec, price]) => (
                            <Tag key={spec} className="font-mono text-[11px]">{`${spec} ¥${formatMoney(price)}`}</Tag>
                        ))}
                    </Space>
                </Row>
            )}
            {model.billingMode === "per_token" && (
                <Row label={t("openPlatform.models.cost.tokenTiers")}>
                    <div className="flex flex-col gap-2 tabular-nums">
                        {tokenRates(model).map((rate, index) => (
                            <div key={index}>
                                {rate.maxInputTokens !== undefined && <div className="text-xs text-stone-500">{t("openPlatform.models.cost.tierCap", { tokens: rate.maxInputTokens.toLocaleString() })}</div>}
                                <div>{t("openPlatform.models.cost.tokenLine", { input: rate.input, output: rate.output })}</div>
                                {rate.cacheRead !== undefined && <div className="text-xs">{t("openPlatform.models.cost.cacheRead", { price: rate.cacheRead })}</div>}
                                {rate.cacheWrite !== undefined && <div className="text-xs">{t("openPlatform.models.cost.cacheWrite", { price: rate.cacheWrite })}</div>}
                            </div>
                        ))}
                        {model.tokenPrices?.peakHours && <div className="text-xs text-stone-500">{t("openPlatform.models.cost.peakHours")}</div>}
                    </div>
                </Row>
            )}
        </div>
    );
}

function ModelCard({ model, onOpen }: { model: ResellerModel; onOpen: () => void }) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            onClick={onOpen}
            className="group flex w-full flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 text-left transition hover:border-stone-400 hover:shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-600"
        >
            <div className="flex items-start gap-3">
                <ModelBrandIcon model={model.id} className="mt-0.5 size-8 shrink-0" />
                <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm text-stone-900 dark:text-stone-100">{model.id}</div>
                    <div className="mt-0.5 truncate text-xs text-stone-500">{model.displayName}</div>
                </div>
                <ChevronRight className="mt-1 size-4 shrink-0 text-stone-400 transition group-hover:translate-x-0.5 group-hover:text-stone-600" />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
                <Tag className="m-0">{t(`settingsPanels.model.capabilities.${model.capability}`, { defaultValue: model.capability })}</Tag>
                <Tag className="m-0">{t(`openPlatform.models.billingModes.${model.billingMode}`)}</Tag>
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-stone-100 pt-3 dark:border-stone-800">
                <span className="text-sm text-stone-900 dark:text-stone-100">
                    <PriceHeadline model={model} />
                </span>
                {model.billingMode !== "per_token" && (
                    <span className="text-xs text-stone-500">
                        {t("openPlatform.models.listPrice")}
                        {` ¥${formatMoney(model.listUnitPrice)}`}
                    </span>
                )}
            </div>

            <div className="flex items-center gap-1 text-xs text-stone-500 group-hover:text-stone-700 dark:group-hover:text-stone-300">{t("openPlatform.models.detail")}</div>
        </button>
    );
}

export default function OpenConsoleModelsPage() {
    const { t } = useTranslation();
    const [models, setModels] = useState<ResellerModel[]>([]);
    const [multiplier, setMultiplier] = useState("1");
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [capability, setCapability] = useState<"all" | ResellerModel["capability"]>("all");
    const [keyword, setKeyword] = useState("");
    const [selectedId, setSelectedId] = useState("");

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

    const selected = useMemo(() => models.find((model) => model.qualifiedId === selectedId), [models, selectedId]);

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

            {loading ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {[0, 1, 2, 3, 4, 5].map((key) => (
                        <div key={key} className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                            <Skeleton active paragraph={{ rows: 3 }} />
                        </div>
                    ))}
                </div>
            ) : filtered.length ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {filtered.map((model) => (
                        <ModelCard key={model.qualifiedId} model={model} onOpen={() => setSelectedId(model.qualifiedId)} />
                    ))}
                </div>
            ) : (
                <div className="rounded-xl border border-dashed border-stone-200 py-10 dark:border-stone-800">
                    <Empty description={t("openPlatform.models.empty")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                </div>
            )}

            <Drawer
                open={Boolean(selected)}
                onClose={() => setSelectedId("")}
                size={MODEL_DRAWER_SIZE}
                destroyOnHidden
                title={
                    selected ? (
                        <div className="flex min-w-0 items-center gap-3 pr-6">
                            <ModelBrandIcon model={selected.id} className="size-8 shrink-0" />
                            <div className="min-w-0">
                                <div className="truncate font-mono text-sm">{selected.id}</div>
                                <div className="truncate text-xs font-normal text-stone-500">{selected.displayName}</div>
                            </div>
                        </div>
                    ) : null
                }
            >
                {selected ? (
                    <div className="flex flex-col gap-3">
                        <DrawerSection title={t("openPlatform.models.drawer.idTitle")} hint={t("openPlatform.models.drawer.copyHint")}>
                            <Row label={t("openPlatform.models.drawer.modelId")}>
                                <Typography.Text copyable={{ text: selected.id }} className="font-mono text-xs">
                                    {selected.id}
                                </Typography.Text>
                            </Row>
                            <Row label={t("openPlatform.models.drawer.modelName")}>{selected.displayName}</Row>
                            <Row label={t("openPlatform.models.capability")}>
                                <Tag className="m-0">{t(`settingsPanels.model.capabilities.${selected.capability}`, { defaultValue: selected.capability })}</Tag>
                            </Row>
                            <Row label={t("openPlatform.models.drawer.usage")}>
                                <span className="text-xs text-stone-500">{t(`openPlatform.models.usageHints.${selected.capability}`, { defaultValue: "" })}</span>
                            </Row>
                        </DrawerSection>

                        <DrawerSection title={t("openPlatform.models.drawer.configTitle")}>
                            <ConfigRows model={selected} />
                        </DrawerSection>

                        <DrawerSection title={t("openPlatform.models.drawer.costTitle")} hint={t("openPlatform.models.drawer.costHint", { surcharge: surchargeLabel(multiplier) })}>
                            <CostRows model={selected} />
                        </DrawerSection>
                    </div>
                ) : null}
            </Drawer>
        </div>
    );
}
