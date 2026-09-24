import { Home } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function NotFound() {
    const { t } = useTranslation();
    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background px-6 py-10 text-foreground">
                <section className="w-full max-w-md text-center">
                    <div className="mb-6 text-7xl font-light tracking-tight text-primary">404</div>
                    <h1 className="text-3xl font-semibold tracking-normal">{t("notFound.title")}</h1>
                    <p className="mt-3 text-sm leading-6 text-stone-500 dark:text-stone-400">{t("notFound.description")}</p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                        <Link to="/" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90">
                            <Home className="size-4" />
                            {t("notFound.home")}
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    );
}
