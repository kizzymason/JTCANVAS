import { createRoot } from "react-dom/client";
import { I18nextProvider, useTranslation } from "react-i18next";

import i18n from "@/i18n";

const HOST_ID = "jtcanvas-page-updated";

export function PageUpdatedPrompt() {
    const { t } = useTranslation();
    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background px-6">
            <section className="w-full max-w-md text-center">
                <h1 className="text-2xl font-semibold tracking-normal text-foreground">{t("pageUpdated.title")}</h1>
                <button
                    type="button"
                    className="mt-8 inline-flex h-10 items-center rounded-lg bg-stone-950 px-4 text-sm font-medium text-white transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-200"
                    onClick={() => window.location.reload()}
                >
                    {t("pageUpdated.refresh")}
                </button>
            </section>
        </div>
    );
}

export function showPageUpdatedPrompt() {
    if (document.getElementById(HOST_ID)) return;
    const host = document.createElement("div");
    host.id = HOST_ID;
    document.body.appendChild(host);
    createRoot(host).render(
        <I18nextProvider i18n={i18n}>
            <PageUpdatedPrompt />
        </I18nextProvider>,
    );
}
