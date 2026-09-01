import { App, Button, Form, Input, Modal } from "antd";
import { Ticket, Wallet } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SegmentedSwitch } from "@/components/ui/segmented-switch";
import { redeemCard } from "@/services/api/account";
import { ApiError, newIdempotencyKey } from "@/services/api/client";
import { formatMoney } from "@/services/api/models";
import { useAuthStore } from "@/stores/use-auth-store";

type RechargeMode = "recharge" | "redeem";

/**
 * Centered over the wallet drawer. The slider matches the login dialog: a small-radius rectangle,
 * inset from the track, switching between online top-up and card redeem.
 */
export function AccountRechargeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const notice = useAuthStore((state) => state.site.rechargeNotice);
    const [mode, setMode] = useState<RechargeMode>("recharge");

    return (
        <Modal
            title={t("account.recharge")}
            open={open}
            onCancel={onClose}
            footer={null}
            centered
            destroyOnHidden
            width={400}
            zIndex={2000}
            styles={{ container: { maxWidth: "calc(100vw - 32px)" } }}
            afterOpenChange={(next) => {
                if (!next) setMode("recharge");
            }}
        >
            <SegmentedSwitch
                className="mb-5"
                value={mode}
                onChange={setMode}
                items={[
                    { value: "recharge", label: t("account.recharge") },
                    { value: "redeem", label: t("account.redeemTab") },
                ]}
            />

            {mode === "recharge" ? (
                <div className="py-2">
                    <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                        <Wallet className="size-4" />
                        {t("account.onlineRecharge")}
                    </p>
                    <p className="text-sm text-stone-500">{notice || t("account.rechargeUnavailable")}</p>
                </div>
            ) : (
                <RedeemForm onSuccess={onClose} />
            )}
        </Modal>
    );
}

function RedeemForm({ onSuccess }: { onSuccess: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [form] = Form.useForm<{ code: string }>();
    const [submitting, setSubmitting] = useState(false);
    const refreshWallet = useAuthStore((state) => state.refreshWallet);

    const submit = async (values: { code: string }) => {
        setSubmitting(true);
        try {
            const result = await redeemCard(values.code, newIdempotencyKey());
            message.success(t("account.redeemSuccess", { amount: formatMoney(result.amount) }));
            form.resetFields();
            await refreshWallet();
            onSuccess();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("account.redeemFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void submit(values)}>
            <Form.Item name="code" label={t("account.redeemCode")} rules={[{ required: true, message: t("account.redeemCodeRequired") }]}>
                <Input size="large" prefix={<Ticket className="size-4 opacity-50" />} placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting} block>
                {t("account.redeemAction")}
            </Button>
        </Form>
    );
}
