import { Alert, App, Button, Card, Form, Input, Switch } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { adminApi, type SiteSettings } from "@/services/api/admin";
import { useAuthStore } from "@/stores/use-auth-store";

export default function AdminSettingsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [form] = Form.useForm<SiteSettings>();
    const [saving, setSaving] = useState(false);
    const bootstrap = useAuthStore((state) => state.bootstrap);
    const setSite = useAuthStore((state) => state.setSite);

    useEffect(() => {
        void adminApi
            .settings()
            .then(({ site }) => {
                form.resetFields();
                form.setFieldsValue({
                    siteName: site.siteName,
                    registrationEnabled: site.registrationEnabled,
                    newUserGiftAmount: site.newUserGiftAmount,
                    rechargeNotice: site.rechargeNotice,
                });
            })
            .catch(() => undefined);
    }, [form]);

    const submit = async (values: Pick<SiteSettings, "siteName" | "registrationEnabled" | "newUserGiftAmount" | "rechargeNotice">) => {
        setSaving(true);
        try {
            const { site } = await adminApi.saveSite({
                siteName: values.siteName,
                registrationEnabled: values.registrationEnabled,
                newUserGiftAmount: values.newUserGiftAmount,
                rechargeNotice: values.rechargeNotice ?? "",
            });
            setSite({
                siteName: site.siteName,
                registrationEnabled: site.registrationEnabled,
                rechargeNotice: site.rechargeNotice,
            });
            message.success(t("admin.settings.saved"));
            await bootstrap();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.settings.title")}</h1>
                <p className="mt-1 text-sm text-stone-500">{t("admin.settings.description")}</p>
            </div>

            <Alert type="warning" showIcon message={t("admin.settings.giftWarning")} />

            <Card size="small" className="max-w-2xl">
                <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void submit(values)}>
                    <Form.Item name="siteName" label={t("admin.settings.siteName")} extra={t("admin.settings.siteNameHint")} rules={[{ required: true }]}>
                        <Input maxLength={64} />
                    </Form.Item>
                    <Form.Item name="registrationEnabled" label={t("admin.settings.registrationEnabled")} extra={t("admin.settings.registrationHint")} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item
                        name="newUserGiftAmount"
                        label={t("admin.settings.newUserGift")}
                        extra={t("admin.settings.newUserGiftHint")}
                        rules={[{ required: true }, { pattern: /^\d{1,12}(\.\d{1,6})?$/, message: t("admin.channels.priceInvalid") }]}
                    >
                        <Input placeholder="0" />
                    </Form.Item>
                    <Form.Item name="rechargeNotice" label={t("admin.settings.rechargeNotice")} extra={t("admin.settings.rechargeNoticeHint")}>
                        <Input.TextArea rows={3} maxLength={500} />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={saving}>
                        {t("common.save")}
                    </Button>
                </Form>
            </Card>
        </div>
    );
}
