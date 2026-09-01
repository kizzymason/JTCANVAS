import { App, Button, Form, Input, Modal } from "antd";
import { Ticket, Wallet } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { redeemCard } from "@/services/api/account";
import { ApiError, newIdempotencyKey } from "@/services/api/client";
import { formatMoney } from "@/services/api/models";
import { useAuthStore } from "@/stores/use-auth-store";

type RechargeMode = "recharge" | "redeem";

/**
 * Centered over the wallet drawer. The slider matches the login page: a small-radius rectangle,
 * not a capsule, switching between online top-up and card redeem.
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
            <div className="relative mb-5 grid grid-cols-2 rounded-md bg-black/5 p-1 dark:bg-white/10">
                <span
                    aria-hidden
                    className={cn(
                        "absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-sm bg-background shadow-sm transition-transform duration-200 dark:bg-stone-700",
                        mode === "redeem" && "translate-x-full",
                    )}
                />
                {(["recharge", "redeem"] as const).map((item) => (
                    <button
                        key={item}
                        type="button"
                        onClick={() => setMode(item)}
                        className={cn("relative z-10 rounded-sm py-1.5 text-sm transition-colors", mode === item ? "font-medium text-stone-950 dark:text-stone-100" : "text-stone-500")}
                    >
                        {t(item === "recharge" ? "account.recharge" : "account.redeemTab")}
                    </button>
                ))}
            </div>

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
