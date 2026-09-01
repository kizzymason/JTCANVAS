import { useTranslation } from "react-i18next";

export default function AdminDocsPage() {
    const { t } = useTranslation();

    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            <div>
                <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("admin.docs.title")}</h1>
                <p className="mt-1 text-sm text-stone-500">{t("admin.docs.description")}</p>
            </div>
            <iframe title={t("admin.docs.title")} src="/api/admin/docs" className="min-h-[70vh] w-full flex-1 rounded-md border-0 bg-white" />
        </div>
    );
}
