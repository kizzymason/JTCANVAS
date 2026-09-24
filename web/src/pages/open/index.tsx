import { Alert, Button, Spin, Tag } from "antd";
import { ArrowRight, BookOpen, Gauge, LineChart, Percent, ShieldCheck, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { apiBaseUrl, resellerApi, type ResellerStatus } from "@/services/api/reseller";

const HIGHLIGHTS = [
    { icon: Zap, titleKey: "openPlatform.landing.features.compatible.title", bodyKey: "openPlatform.landing.features.compatible.body" },
    { icon: Percent, titleKey: "openPlatform.landing.features.pricing.title", bodyKey: "openPlatform.landing.features.pricing.body" },
    { icon: Gauge, titleKey: "openPlatform.landing.features.console.title", bodyKey: "openPlatform.landing.features.console.body" },
    { icon: ShieldCheck, titleKey: "openPlatform.landing.features.control.title", bodyKey: "openPlatform.landing.features.control.body" },
];

export default function OpenPlatformLandingPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [status, setStatus] = useState<ResellerStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);

    useEffect(() => {
        void resellerApi
            .status()
            .then(setStatus)
            .catch(() => setLoadFailed(true))
            .finally(() => setLoading(false));
    }, []);

    const canUseConsole = status?.canUseConsole;

    return (
        // UserLayout clips its children, so every page owns its own scrolling.
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12">
                <header className="flex flex-col items-start gap-4">
                    <Tag color="gold" className="uppercase tracking-[0.2em]">
                        {t("openPlatform.landing.badge")}
                    </Tag>
                    <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t("openPlatform.landing.title")}</h1>
                    <p className="max-w-2xl text-base text-muted-foreground">{t("openPlatform.landing.subtitle")}</p>
                    <div className="flex flex-wrap items-center gap-3">
                        {canUseConsole ? (
                            <Button type="primary" size="large" icon={<Gauge className="size-4" />} onClick={() => navigate("/open/console")}>
                                {t("openPlatform.landing.enterConsole")}
                            </Button>
                        ) : null}
                        <Link to="/open/docs">
                            <Button size="large" icon={<BookOpen className="size-4" />}>
                                {t("openPlatform.landing.readDocs")}
                            </Button>
                        </Link>
                    </div>
                    <div className="w-full rounded-lg border border-border bg-card p-4 font-mono text-xs">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-500">{t("openPlatform.landing.baseUrl")}</div>
                        <div className="break-all text-foreground">{apiBaseUrl()}</div>
                    </div>
                </header>

                <section className="grid gap-3 sm:grid-cols-2">
                    {HIGHLIGHTS.map((item) => (
                        <div key={item.titleKey} className="rounded-lg border border-border p-4">
                            <item.icon className="size-5 text-stone-500" />
                            <h2 className="mt-3 text-base font-semibold text-foreground">{t(item.titleKey)}</h2>
                            <p className="mt-1 text-sm text-muted-foreground">{t(item.bodyKey)}</p>
                        </div>
                    ))}
                </section>

                <section className="flex flex-col gap-4">
                    {loadFailed ? <Alert type="error" message="加载开放平台权限失败，请刷新后重试" /> : null}
                    <div>
                        <h2 className="text-xl font-semibold text-foreground">{t("openPlatform.apply.title")}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">{t("openPlatform.apply.description")}</p>
                    </div>

                    {loading ? (
                        <div className="flex min-h-[120px] items-center justify-center">
                            <Spin />
                        </div>
                    ) : (
                        <>
                            {status?.status === "pending" ? <Alert type="info" showIcon message={t("openPlatform.apply.pendingTitle")} description={t("openPlatform.apply.pendingHint")} /> : null}
                            {status?.status === "rejected" ? <Alert type="error" showIcon message={t("openPlatform.apply.rejectedTitle")} description={status.rejectReason || t("openPlatform.apply.rejectedNoReason")} /> : null}
                            {status?.status === "suspended" ? <Alert type="warning" showIcon message={t("openPlatform.apply.suspendedTitle")} description={t("openPlatform.apply.suspendedHint")} /> : null}
                            {status?.status === "approved" ? (
                                <Alert
                                    type="success"
                                    showIcon
                                    message={t("openPlatform.apply.approvedTitle")}
                                    description={t("openPlatform.apply.approvedHint", { tier: status.tierName || t("openPlatform.profile.noTier") })}
                                    action={
                                        <Button size="small" type="primary" icon={<ArrowRight className="size-3.5" />} iconPlacement="end" onClick={() => navigate("/open/console")}>
                                            {t("openPlatform.landing.enterConsole")}
                                        </Button>
                                    }
                                />
                            ) : null}
                        </>
                    )}
                </section>

                <section className="rounded-lg border border-border p-5">
                    <div className="flex items-center gap-2">
                        <LineChart className="size-4 text-stone-500" />
                        <h2 className="text-base font-semibold text-foreground">{t("openPlatform.landing.pricingTitle")}</h2>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("openPlatform.landing.pricingBody")}</p>
                </section>
            </div>

        </main>
    );
}
