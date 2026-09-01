import { App, Button, Form, Input } from "antd";
import { KeyRound, Loader2, User } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { ApiError } from "@/services/api/client";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/use-auth-store";

type Mode = "login" | "register";
type FormValues = { username: string; password: string; confirmPassword?: string };

/**
 * Login and registration share one page, toggled by a sliding switch, so a visitor arriving from the
 * homepage CTA never has to navigate again to create an account.
 */
export default function LoginPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const [form] = Form.useForm<FormValues>();
    const [mode, setMode] = useState<Mode>("login");
    const [submitting, setSubmitting] = useState(false);

    const site = useAuthStore((state) => state.site);
    const login = useAuthStore((state) => state.login);
    const register = useAuthStore((state) => state.register);

    // Returns the visitor to whatever they were trying to reach before the guard intervened.
    const redirectTo = (location.state as { from?: string } | null)?.from || "/canvas";

    const switchMode = (next: Mode) => {
        if (next === mode) return;
        setMode(next);
        form.resetFields(["confirmPassword"]);
    };

    const submit = async (values: FormValues) => {
        setSubmitting(true);
        try {
            if (mode === "register") await register(values.username.trim(), values.password);
            else await login(values.username.trim(), values.password);
            message.success(t(mode === "register" ? "auth.registerSuccess" : "auth.loginSuccess"));
            navigate(redirectTo, { replace: true });
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("auth.failed"));
        } finally {
            setSubmitting(false);
        }
    };

    const registrationClosed = mode === "register" && !site.registrationEnabled;

    return (
        <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
            <div className="w-full max-w-md">
                <div className="mb-8 text-center">
                    <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">{site.siteName}</h1>
                    <p className="mt-2 text-sm text-stone-500">{t("auth.subtitle")}</p>
                </div>

                <div className="rounded-2xl border border-stone-200 bg-background p-6 shadow-sm dark:border-stone-800">
                    {/* Sliding switch between the two modes. */}
                    <div className="relative mb-6 grid grid-cols-2 rounded-md bg-black/5 p-1 dark:bg-white/10">
                        <span
                            aria-hidden
                            className={cn("absolute inset-y-1 w-[calc(50%-4px)] rounded-sm bg-background shadow-sm transition-transform duration-200 dark:bg-stone-700", mode === "register" && "translate-x-[calc(100%+8px)]")}
                        />
                        {(["login", "register"] as const).map((item) => (
                            <button
                                key={item}
                                type="button"
                                onClick={() => switchMode(item)}
                                className={cn("relative z-10 rounded-sm py-1.5 text-sm transition-colors", mode === item ? "font-medium text-stone-950 dark:text-stone-100" : "text-stone-500")}
                            >
                                {t(item === "login" ? "auth.login" : "auth.register")}
                            </button>
                        ))}
                    </div>

                    <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void submit(values)} disabled={submitting}>
                        <Form.Item
                            name="username"
                            label={t("auth.username")}
                            rules={[
                                { required: true, message: t("auth.usernameRequired") },
                                { min: 3, max: 32, message: t("auth.usernameLength") },
                                { pattern: /^[a-zA-Z0-9_-]+$/, message: t("auth.usernamePattern") },
                            ]}
                        >
                            <Input size="large" autoComplete="username" prefix={<User className="size-4 opacity-50" />} placeholder={t("auth.usernamePlaceholder")} />
                        </Form.Item>

                        <Form.Item name="password" label={t("auth.password")} rules={[{ required: true, message: t("auth.passwordRequired") }, { min: 8, message: t("auth.passwordLength") }]}>
                            <Input.Password size="large" autoComplete={mode === "register" ? "new-password" : "current-password"} prefix={<KeyRound className="size-4 opacity-50" />} placeholder={t("auth.passwordPlaceholder")} />
                        </Form.Item>

                        {mode === "register" ? (
                            <Form.Item
                                name="confirmPassword"
                                label={t("auth.confirmPassword")}
                                dependencies={["password"]}
                                rules={[
                                    { required: true, message: t("auth.confirmPasswordRequired") },
                                    ({ getFieldValue }) => ({
                                        validator: (_rule, value) => (!value || value === getFieldValue("password") ? Promise.resolve() : Promise.reject(new Error(t("auth.passwordMismatch")))),
                                    }),
                                ]}
                            >
                                <Input.Password size="large" autoComplete="new-password" prefix={<KeyRound className="size-4 opacity-50" />} placeholder={t("auth.confirmPasswordPlaceholder")} />
                            </Form.Item>
                        ) : null}

                        {registrationClosed ? <p className="mb-4 text-sm text-amber-600">{t("auth.registrationClosed")}</p> : null}

                        <Button type="primary" size="large" htmlType="submit" block loading={submitting} disabled={registrationClosed} icon={submitting ? <Loader2 className="size-4 animate-spin" /> : undefined}>
                            {t(mode === "register" ? "auth.registerAction" : "auth.loginAction")}
                        </Button>
                    </Form>

                    <p className="mt-4 text-center text-xs text-stone-500">{t(mode === "register" ? "auth.registerHint" : "auth.loginHint")}</p>
                </div>
            </div>
        </main>
    );
}
