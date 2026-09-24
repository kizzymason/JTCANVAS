import { Alert, App, Button, Descriptions, Form, Input, Spin, Tag } from "antd";
import Decimal from "decimal.js";
import { Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AccountRechargeModal } from "@/components/account/account-recharge-modal";
import { OpsKpi, OpsPanel } from "@/pages/admin/ops-charts";
import { ApiError } from "@/services/api/client";
import { formatMoney } from "@/services/api/models";
import { resellerApi, type ResellerProfile, type ResellerProfileForm } from "@/services/api/reseller";

function surchargeLabel(surcharge: string) {
    try {
        const value = new Decimal(surcharge).times(100);
        if (value.isZero()) return "0%";
        return `${value.isPositive() ? "+" : ""}${value.toDecimalPlaces(2).toString()}%`;
    } catch {
        return "0%";
    }
}

export default function OpenConsoleProfilePage() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [form] = Form.useForm<ResellerProfileForm>();
    const [profile, setProfile] = useState<ResellerProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [rechargeOpen, setRechargeOpen] = useState(false);

    const load = useCallback(async () => {
        try {
            const result = await resellerApi.profile();
            setProfile(result);
            if (result.profile) form.setFieldsValue(result.profile);
            setLoadError("");
        } catch (error) {
            setLoadError(error instanceof ApiError ? error.message : t("openPlatform.profile.loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [form, t]);

    useEffect(() => {
        void load();
    }, [load]);

    const save = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            await resellerApi.apply(values);
            message.success(t("openPlatform.profile.applicationSubmitted"));
            await load();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("openPlatform.profile.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex min-h-[240px] items-center justify-center">
                <Spin />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("openPlatform.profile.title")}</h1>
                <p className="mt-1 text-sm text-stone-500">{t("openPlatform.profile.description")}</p>
            </div>

            {loadError ? <Alert type="error" showIcon message={loadError} /> : null}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <OpsKpi label={t("openPlatform.profile.tier")} value={profile?.tierName || t("openPlatform.profile.noTier")} hint={t("openPlatform.profile.surchargeHint", { surcharge: surchargeLabel(profile?.surcharge ?? "0") })} />
                <OpsKpi label={t("openPlatform.profile.balance")} value={`¥${formatMoney(profile?.wallet.balance)}`} hint={t("openPlatform.profile.frozenHint", { amount: formatMoney(profile?.wallet.frozen) })} />
                <OpsKpi label={t("openPlatform.profile.lifetimeSpend")} value={`¥${formatMoney(profile?.lifetime.billedAmount)}`} hint={t("openPlatform.profile.lifetimeRequests", { count: profile?.lifetime.requests ?? 0 })} />
                <OpsKpi
                    label={t("openPlatform.profile.lifetimeTokens")}
                    value={String((profile?.lifetime.inputTokens ?? 0) + (profile?.lifetime.outputTokens ?? 0))}
                    hint={t("openPlatform.profile.tokenSplit", { input: profile?.lifetime.inputTokens ?? 0, output: profile?.lifetime.outputTokens ?? 0 })}
                />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
                <OpsPanel
                    title={t("openPlatform.profile.account")}
                    caption={t("openPlatform.profile.accountCaption")}
                    extra={
                        <Button size="small" type="primary" icon={<Wallet className="size-3.5" />} onClick={() => setRechargeOpen(true)}>
                            {t("account.recharge")}
                        </Button>
                    }
                >
                    <Descriptions
                        column={1}
                        size="small"
                        items={[
                            { key: "username", label: t("openPlatform.profile.username"), children: profile?.username || "-" },
                            {
                                key: "status",
                                label: t("openPlatform.profile.status"),
                                children: <Tag color={profile?.status === "approved" ? "green" : "orange"}>{t(`openPlatform.apply.statuses.${profile?.status ?? "none"}`)}</Tag>,
                            },
                            { key: "tier", label: t("openPlatform.profile.tier"), children: profile?.tierName || t("openPlatform.profile.noTier") },
                            { key: "surcharge", label: t("openPlatform.profile.surcharge"), children: surchargeLabel(profile?.surcharge ?? "0") },
                            { key: "reviewedAt", label: t("openPlatform.profile.reviewedAt"), children: profile?.reviewedAt ? new Date(profile.reviewedAt).toLocaleString() : "-" },
                            { key: "totalRecharged", label: t("openPlatform.profile.totalRecharged"), children: `¥${formatMoney(profile?.wallet.totalRecharged)}` },
                        ]}
                    />
                </OpsPanel>

                <OpsPanel title={t("openPlatform.profile.upgradeTitle")} caption={t("openPlatform.profile.upgradeCaption")}>
                    {profile?.status === "pending" ? <Alert className="mb-4" type="info" showIcon message={t("openPlatform.apply.pendingTitle")} description={t("openPlatform.apply.pendingHint")} /> : null}
                    {profile?.status === "rejected" ? <Alert className="mb-4" type="warning" showIcon message={t("openPlatform.apply.rejectedTitle")} description={profile.rejectReason || t("openPlatform.apply.rejectedNoReason")} /> : null}
                    <Form form={form} layout="vertical" requiredMark={false} disabled={!profile || profile.status === "pending" || Boolean(loadError)}>
                        <Form.Item name="companyName" label={t("openPlatform.apply.companyName")} rules={[{ required: true, min: 2, max: 128 }]}>
                            <Input />
                        </Form.Item>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Form.Item name="contactEmail" label={t("openPlatform.apply.contactEmail")} rules={[{ type: "email", message: t("openPlatform.apply.emailInvalid") }]}>
                                <Input />
                            </Form.Item>
                            <Form.Item name="website" label={t("openPlatform.apply.website")}>
                                <Input placeholder="https://" />
                            </Form.Item>
                        </div>
                        <Form.Item name="useCase" label={t("openPlatform.apply.useCase")} rules={[{ required: true, min: 10, max: 2000 }]}>
                            <Input.TextArea rows={4} />
                        </Form.Item>
                        <Button type="primary" loading={saving} onClick={() => void save()}>
                            {t("openPlatform.profile.submitUpgrade")}
                        </Button>
                    </Form>
                </OpsPanel>
            </div>

            <AccountRechargeModal open={rechargeOpen} onClose={() => setRechargeOpen(false)} />
        </div>
    );
}
