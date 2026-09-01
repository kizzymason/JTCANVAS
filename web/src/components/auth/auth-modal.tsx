import { App, Button, Form, Input } from "antd";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { KeyRound, Loader2, User, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { SegmentedSwitch } from "@/components/ui/segmented-switch";
import { ApiError } from "@/services/api/client";
import { useAuthModalStore, type AuthModalMode } from "@/stores/use-auth-modal-store";
import { useAuthStore } from "@/stores/use-auth-store";

type FormValues = { username: string; password: string; confirmPassword?: string };

const PANEL_SPRING = { type: "spring", stiffness: 380, damping: 32, mass: 0.82 } as const;
const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Login and registration share one dialog. Protected nav opens this instead of sending the visitor
 * to a full-page /login route.
 */
export function AuthModal() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const reduceMotion = useReducedMotion();
    const [form] = Form.useForm<FormValues>();
    const [submitting, setSubmitting] = useState(false);

    const open = useAuthModalStore((state) => state.open);
    const mode = useAuthModalStore((state) => state.mode);
    const redirectTo = useAuthModalStore((state) => state.redirectTo);
    const closeModal = useAuthModalStore((state) => state.closeModal);
    const setMode = useAuthModalStore((state) => state.setMode);

    const site = useAuthStore((state) => state.site);
    const user = useAuthStore((state) => state.user);
    const login = useAuthStore((state) => state.login);
    const register = useAuthStore((state) => state.register);

    useEffect(() => {
        if (user && open) closeModal();
    }, [closeModal, open, user]);

    useEffect(() => {
        if (!open) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !submitting) closeModal();
        };
        window.addEventListener("keydown", onKey);
        return () => {
            document.body.style.overflow = previous;
            window.removeEventListener("keydown", onKey);
        };
    }, [closeModal, open, submitting]);

    useEffect(() => {
        if (!open) {
            form.resetFields();
            setSubmitting(false);
        }
    }, [form, open]);

    const switchMode = (next: AuthModalMode) => {
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
            closeModal();
            navigate(redirectTo, { replace: true });
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : t("auth.failed"));
        } finally {
            setSubmitting(false);
        }
    };

    const registrationClosed = mode === "register" && !site.registrationEnabled;
    const motionOff = Boolean(reduceMotion);

    if (typeof document === "undefined") return null;

    return createPortal(
        <AnimatePresence>
            {open ? (
                <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4" role="presentation">
                    <motion.div
                        aria-hidden
                        className="absolute inset-0 bg-stone-950/40 backdrop-blur-[6px] dark:bg-black/55"
                        initial={motionOff ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={motionOff ? { opacity: 0 } : { opacity: 0 }}
                        transition={motionOff ? { duration: 0 } : { duration: 0.28, ease: EASE }}
                        onClick={() => {
                            if (!submitting) closeModal();
                        }}
                    />
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="auth-modal-title"
                        className="relative z-10 w-full max-w-md rounded-2xl border border-stone-200 bg-background p-6 shadow-[0_24px_80px_rgba(28,25,23,0.18)] dark:border-stone-800 dark:shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
                        initial={motionOff ? false : { opacity: 0, y: 18, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={motionOff ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
                        transition={motionOff ? { duration: 0 } : PANEL_SPRING}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={() => {
                                if (!submitting) closeModal();
                            }}
                            className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-black/5 hover:text-stone-700 dark:hover:bg-white/10 dark:hover:text-stone-200"
                            aria-label={t("auth.close")}
                        >
                            <X className="size-4" />
                        </button>

                        <div className="mb-6 pr-8 text-center">
                            <h1 id="auth-modal-title" className="text-xl font-semibold text-stone-950 dark:text-stone-100">
                                {site.siteName}
                            </h1>
                            <p className="mt-2 text-sm text-stone-500">{t("auth.subtitle")}</p>
                        </div>

                        <SegmentedSwitch
                            className="mb-6"
                            value={mode}
                            onChange={switchMode}
                            items={[
                                { value: "login", label: t("auth.login") },
                                { value: "register", label: t("auth.register") },
                            ]}
                        />

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
                                <Input size="large" autoComplete="username" prefix={<User className="size-4 opacity-50" />} placeholder={t("auth.usernamePlaceholder")} autoFocus />
                            </Form.Item>

                            <Form.Item name="password" label={t("auth.password")} rules={[{ required: true, message: t("auth.passwordRequired") }, { min: 8, message: t("auth.passwordLength") }]}>
                                <Input.Password size="large" autoComplete={mode === "register" ? "new-password" : "current-password"} prefix={<KeyRound className="size-4 opacity-50" />} placeholder={t("auth.passwordPlaceholder")} />
                            </Form.Item>

                            <AnimatePresence initial={false}>
                                {mode === "register" ? (
                                    <motion.div
                                        key="confirm-password"
                                        initial={motionOff ? false : { height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={motionOff ? undefined : { height: 0, opacity: 0 }}
                                        transition={motionOff ? { duration: 0 } : { duration: 0.32, ease: EASE }}
                                        className="overflow-hidden"
                                    >
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
                                    </motion.div>
                                ) : null}
                            </AnimatePresence>

                            {registrationClosed ? <p className="mb-4 text-sm text-amber-600">{t("auth.registrationClosed")}</p> : null}

                            <Button type="primary" size="large" htmlType="submit" block loading={submitting} disabled={registrationClosed} icon={submitting ? <Loader2 className="size-4 animate-spin" /> : undefined}>
                                {t(mode === "register" ? "auth.registerAction" : "auth.loginAction")}
                            </Button>
                        </Form>

                        <p className="mt-4 text-center text-xs text-stone-500">{t(mode === "register" ? "auth.registerHint" : "auth.loginHint")}</p>
                    </motion.div>
                </div>
            ) : null}
        </AnimatePresence>,
        document.body,
    );
}
