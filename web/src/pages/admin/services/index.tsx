import { App, Button, Card, Form, Switch } from "antd";
import { Bot, Image as ImageIcon, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { adminApi, type ServiceSettings } from "@/services/api/admin";
import { useAuthStore } from "@/stores/use-auth-store";

export default function AdminServicesPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [form] = Form.useForm<ServiceSettings>();
    const [saving, setSaving] = useState(false);
    const bootstrap = useAuthStore((state) => state.bootstrap);

    useEffect(() => {
        void adminApi
            .settings()
            .then(({ site }) =>
                form.setFieldsValue({
                    imageGenerationEnabled: site.imageGenerationEnabled,
                    videoGenerationEnabled: site.videoGenerationEnabled,
                    agentEnabled: site.agentEnabled,
                }),
            )
            .catch(() => undefined);
    }, [form]);

    const submit = async (values: ServiceSettings) => {
        setSaving(true);
        try {
            await adminApi.saveServices(values);
            message.success(t("admin.services.saved"));
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
                <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.services.title")}</h1>
                <p className="mt-1 text-sm text-stone-500">{t("admin.services.description")}</p>
            </div>

            <Card size="small" className="max-w-2xl">
                <Form form={form} layout="vertical" requiredMark={false} initialValues={{ imageGenerationEnabled: true, videoGenerationEnabled: true, agentEnabled: true }} onFinish={(values) => void submit(values)}>
                    <Form.Item name="imageGenerationEnabled" label={<span className="inline-flex items-center gap-2"><ImageIcon className="size-4" />{t("admin.services.image")}</span>} extra={t("admin.services.imageHint")} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item name="videoGenerationEnabled" label={<span className="inline-flex items-center gap-2"><Video className="size-4" />{t("admin.services.video")}</span>} extra={t("admin.services.videoHint")} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item name="agentEnabled" label={<span className="inline-flex items-center gap-2"><Bot className="size-4" />{t("admin.services.agent")}</span>} extra={t("admin.services.agentHint")} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={saving}>
                        {t("common.save")}
                    </Button>
                </Form>
            </Card>
        </div>
    );
}
