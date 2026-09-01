import { Alert, App, Button, Card, Form, Input, Select, Switch } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { adminApi, type StorageSettings } from "@/services/api/admin";

type FormValues = {
    driver: "local" | "s3";
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    publicBaseUrl: string;
};

/** Storage strategy. Switching driver changes where new files land; existing files stay where they are. */
export default function AdminStoragePage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [form] = Form.useForm<FormValues>();
    const [saving, setSaving] = useState(false);
    const [current, setCurrent] = useState<StorageSettings | null>(null);
    const driver = Form.useWatch("driver", form);

    useEffect(() => {
        void adminApi
            .settings()
            .then(({ storage }) => {
                setCurrent(storage);
                form.setFieldsValue({ driver: storage.driver, ...storage.s3, secretAccessKey: "" });
            })
            .catch(() => undefined);
    }, [form]);

    const submit = async (values: FormValues) => {
        setSaving(true);
        try {
            await adminApi.saveStorage({
                driver: values.driver,
                s3: {
                    endpoint: values.endpoint,
                    region: values.region,
                    bucket: values.bucket,
                    accessKeyId: values.accessKeyId,
                    // Blank means "keep the stored secret", so an admin can edit without re-typing it.
                    secretAccessKey: values.secretAccessKey || undefined,
                    forcePathStyle: values.forcePathStyle,
                    publicBaseUrl: values.publicBaseUrl,
                },
            });
            message.success(t("admin.storage.saved"));
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("admin.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.storage.title")}</h1>
                <p className="mt-1 text-sm text-stone-500">{t("admin.storage.description")}</p>
            </div>

            <Alert type="info" showIcon message={t("admin.storage.switchNotice")} />

            <Card size="small" className="max-w-2xl">
                <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void submit(values)}>
                    <Form.Item name="driver" label={t("admin.storage.driver")} extra={t("admin.storage.driverHint")}>
                        <Select
                            options={[
                                { value: "local", label: t("admin.storage.local") },
                                { value: "s3", label: t("admin.storage.s3") },
                            ]}
                        />
                    </Form.Item>

                    {driver === "s3" ? (
                        <>
                            <Form.Item name="endpoint" label={t("admin.storage.endpoint")} extra={t("admin.storage.endpointHint")}>
                                <Input placeholder="https://s3.example.com" />
                            </Form.Item>
                            <Form.Item name="region" label={t("admin.storage.region")}>
                                <Input placeholder="us-east-1" />
                            </Form.Item>
                            <Form.Item name="bucket" label={t("admin.storage.bucket")} rules={[{ required: true, message: t("admin.storage.bucketRequired") }]}>
                                <Input />
                            </Form.Item>
                            <Form.Item name="accessKeyId" label={t("admin.storage.accessKeyId")}>
                                <Input autoComplete="off" />
                            </Form.Item>
                            <Form.Item name="secretAccessKey" label={t("admin.storage.secretAccessKey")} extra={t("admin.storage.secretHint")}>
                                <Input.Password autoComplete="off" placeholder={current?.s3.hasSecret ? "••••••••" : ""} />
                            </Form.Item>
                            <Form.Item name="publicBaseUrl" label={t("admin.storage.publicBaseUrl")} extra={t("admin.storage.publicBaseUrlHint")}>
                                <Input placeholder="https://cdn.example.com" />
                            </Form.Item>
                            <Form.Item name="forcePathStyle" label={t("admin.storage.forcePathStyle")} extra={t("admin.storage.forcePathStyleHint")} valuePropName="checked">
                                <Switch />
                            </Form.Item>
                        </>
                    ) : (
                        <p className="mb-4 text-sm text-stone-500">{t("admin.storage.localHint")}</p>
                    )}

                    <Button type="primary" htmlType="submit" loading={saving}>
                        {t("common.save")}
                    </Button>
                </Form>
            </Card>
        </div>
    );
}
