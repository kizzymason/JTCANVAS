import { Alert, App, Button, Form, Input, Modal, Spin, Steps, Tag } from "antd";
import { ArrowRight, BookOpen, Gauge, KeyRound, LineChart, Percent, ShieldCheck, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { ApiError } from "@/services/api/client";
import { apiBaseUrl, resellerApi, type ResellerProfileForm, type ResellerStatus } from "@/services/api/reseller";
import { useAuthStore } from "@/stores/use-auth-store";

const HIGHLIGHTS = [
    { icon: Zap, titleKey: "openPlatform.landing.features.compatible.title", bodyKey: "openPlatform.landing.features.compatible.body" },
    { icon: Percent, titleKey: "openPlatform.landing.features.pricing.title", bodyKey: "openPlatform.landing.features.pricing.body" },
    { icon: Gauge, titleKey: "openPlatform.landing.features.console.title", bodyKey: "openPlatform.landing.features.console.body" },
    { icon: ShieldCheck, titleKey: "openPlatform.landing.features.control.title", bodyKey: "openPlatform.landing.features.control.body" },
];

const STATUS_STEP: Record<ResellerStatus["status"], number> = { none: 0, rejected: 0, pending: 1, approved: 2, suspended: 1 };

export default function OpenPlatformLandingPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const user = useAuthStore((state) => state.user);
    const [status, setStatus] = useState<ResellerStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [applyOpen, setApplyOpen] = useState(false);

    useEffect(() => {
        void resellerApi
            .status()
            .then(setStatus)
            .catch(() => undefined)
            .finally(() => setLoading(false));
    }, []);

    // Admins reach the console without applying, so the entry point does not wait on an application.
    const canUseConsole = status?.canUseConsole || user?.role === "admin" || user?.role === "reseller";
    const canApply = !status || status.status === "none" || status.status === "rejected";

    return (
        // UserLayout clips its children, so every page owns its own scrolling.
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12">
                <header className="flex flex-col items-start gap-4">
                    <Tag color="gold" className="uppercase tracking-[0.2em]">
                        {t("openPlatform.landing.badge")}
                    </Tag>
                    <h1 className="text-3xl font-semibold tracking-tight text-stone-950 dark:text-stone-100 sm:text-4xl">{t("openPlatform.landing.title")}</h1>
                    <p className="max-w-2xl text-base text-stone-600 dark:text-stone-300">{t("openPlatform.landing.subtitle")}</p>
                    <div className="flex flex-wrap items-center gap-3">
                        {canUseConsole ? (
                            <Button type="primary" size="large" icon={<Gauge className="size-4" />} onClick={() => navigate("/open/console")}>
                                {t("openPlatform.landing.enterConsole")}
                            </Button>
                        ) : null}
                        {canApply ? (
                            <Button type={canUseConsole ? "default" : "primary"} size="large" icon={<KeyRound className="size-4" />} onClick={() => setApplyOpen(true)}>
                                {t(status?.status === "rejected" ? "openPlatform.apply.resubmit" : "openPlatform.apply.submit")}
                            </Button>
                        ) : null}
                        <Link to="/open/docs">
                            <Button size="large" icon={<BookOpen className="size-4" />}>
                                {t("openPlatform.landing.readDocs")}
                            </Button>
                        </Link>
                    </div>
                    <div className="w-full rounded-lg border border-stone-200 bg-stone-50 p-4 font-mono text-xs dark:border-stone-800 dark:bg-stone-900">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-500">{t("openPlatform.landing.baseUrl")}</div>
                        <div className="break-all text-stone-950 dark:text-stone-100">{apiBaseUrl()}</div>
                    </div>
                </header>

                <section className="grid gap-3 sm:grid-cols-2">
                    {HIGHLIGHTS.map((item) => (
                        <div key={item.titleKey} className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                            <item.icon className="size-5 text-stone-500" />
                            <h2 className="mt-3 text-base font-semibold text-stone-950 dark:text-stone-100">{t(item.titleKey)}</h2>
                            <p className="mt-1 text-sm text-stone-500">{t(item.bodyKey)}</p>
                        </div>
                    ))}
                </section>

                <section className="flex flex-col gap-4">
                    <div>
                        <h2 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("openPlatform.apply.title")}</h2>
                        <p className="mt-1 text-sm text-stone-500">{t("openPlatform.apply.description")}</p>
                    </div>

                    {loading ? (
                        <div className="flex min-h-[120px] items-center justify-center">
                            <Spin />
                        </div>
                    ) : (
                        <>
                            <Steps
                                size="small"
                                current={STATUS_STEP[status?.status ?? "none"]}
                                status={status?.status === "rejected" || status?.status === "suspended" ? "error" : "process"}
                                items={[{ title: t("openPlatform.apply.steps.submit") }, { title: t("openPlatform.apply.steps.review") }, { title: t("openPlatform.apply.steps.integrate") }]}
                            />

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
                            {user?.role === "admin" && status?.status !== "approved" ? <Alert type="info" showIcon message={t("openPlatform.apply.adminTitle")} description={t("openPlatform.apply.adminHint")} /> : null}
                        </>
                    )}
                </section>

                <section className="rounded-lg border border-stone-200 p-5 dark:border-stone-800">
                    <div className="flex items-center gap-2">
                        <LineChart className="size-4 text-stone-500" />
                        <h2 className="text-base font-semibold text-stone-950 dark:text-stone-100">{t("openPlatform.landing.pricingTitle")}</h2>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-stone-500">{t("openPlatform.landing.pricingBody")}</p>
                </section>
            </div>

            <ApplyModal open={applyOpen} status={status} onClose={() => setApplyOpen(false)} onApplied={setStatus} />
        </main>
    );
}

function ApplyModal({ open, status, onClose, onApplied }: { open: boolean; status: ResellerStatus | null; onClose: () => void; onApplied: (status: ResellerStatus) => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [form] = Form.useForm<ResellerProfileForm>();
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        // A rejected applicant edits their previous answers rather than retyping them.
        if (status?.profile) form.setFieldsValue(status.profile);
    }, [form, open, status]);

    const submit = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            onApplied(await resellerApi.apply(values));
            message.success(t("openPlatform.apply.submitted"));
            onClose();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("openPlatform.apply.submitFailed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open={open}
            width={640}
            title={t("openPlatform.apply.modalTitle")}
            onCancel={onClose}
            onOk={() => void submit()}
            confirmLoading={saving}
            okText={t(status?.status === "rejected" ? "openPlatform.apply.resubmit" : "openPlatform.apply.submit")}
            destroyOnHidden
        >
            <p className="mb-4 text-sm text-stone-500">{t("openPlatform.apply.modalHint")}</p>
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item name="companyName" label={t("openPlatform.apply.companyName")} rules={[{ required: true, min: 2, max: 128 }]}>
                    <Input placeholder={t("openPlatform.apply.companyPlaceholder")} />
                </Form.Item>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Form.Item name="contactName" label={t("openPlatform.apply.contactName")} rules={[{ required: true, max: 64 }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="contactPhone" label={t("openPlatform.apply.contactPhone")} rules={[{ required: true, min: 5, max: 32 }]}>
                        <Input />
                    </Form.Item>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Form.Item name="contactEmail" label={t("openPlatform.apply.contactEmail")} rules={[{ type: "email", message: t("openPlatform.apply.emailInvalid") }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="website" label={t("openPlatform.apply.website")}>
                        <Input placeholder="https://" />
                    </Form.Item>
                </div>
                <Form.Item name="expectedVolume" label={t("openPlatform.apply.expectedVolume")} extra={t("openPlatform.apply.expectedVolumeHint")}>
                    <Input placeholder={t("openPlatform.apply.expectedVolumePlaceholder")} />
                </Form.Item>
                <Form.Item name="useCase" label={t("openPlatform.apply.useCase")} extra={t("openPlatform.apply.useCaseHint")} rules={[{ required: true, min: 10, max: 2000 }]}>
                    <Input.TextArea rows={5} placeholder={t("openPlatform.apply.useCasePlaceholder")} />
                </Form.Item>
            </Form>
        </Modal>
    );
}
