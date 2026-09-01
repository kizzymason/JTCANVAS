import { Alert, App, Button, Card, Progress } from "antd";
import { HardDriveUpload } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { inspectLocalData, migrateLocalDataToCloud, type MigrationProgress, type MigrationSummary } from "@/services/local-data-migration";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

/**
 * One-time importer for users who used the browser-only version. Only rendered when leftover local
 * data is actually found, so it disappears for everyone else instead of adding permanent clutter.
 */
export function LocalDataMigrationCard() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [found, setFound] = useState<{ projects: number; assets: number; files: number } | null>(null);
    const [progress, setProgress] = useState<MigrationProgress | null>(null);
    const [summary, setSummary] = useState<MigrationSummary | null>(null);
    const [running, setRunning] = useState(false);
    const loadProjects = useCanvasStore((state) => state.loadProjects);

    useEffect(() => {
        void inspectLocalData()
            .then((result) => setFound(result.projects || result.assets ? result : null))
            .catch(() => setFound(null));
    }, []);

    if (!found && !summary) return null;

    const run = async () => {
        setRunning(true);
        try {
            const result = await migrateLocalDataToCloud(setProgress);
            setSummary(result);
            await loadProjects().catch(() => undefined);
            message.success(t("account.migration.done", { projects: result.projects, assets: result.assets }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.migration.failed"));
        } finally {
            setRunning(false);
        }
    };

    return (
        <Card size="small" className="mb-4" title={<span className="flex items-center gap-2"><HardDriveUpload className="size-4" />{t("account.migration.title")}</span>}>
            {summary ? (
                <Alert type="success" showIcon message={t("account.migration.summary", { projects: summary.projects, assets: summary.assets, files: summary.files, skipped: summary.skipped })} description={t("account.migration.summaryHint")} />
            ) : (
                <>
                    <p className="mb-3 text-sm text-stone-500">{t("account.migration.description", { projects: found?.projects ?? 0, assets: found?.assets ?? 0, files: found?.files ?? 0 })}</p>
                    {progress ? <Progress percent={progress.total ? Math.round((progress.current / progress.total) * 100) : 0} status={running ? "active" : "normal"} format={() => progress.message} /> : null}
                    <Button type="primary" loading={running} onClick={() => void run()}>
                        {t("account.migration.action")}
                    </Button>
                    <p className="mt-2 text-xs text-stone-500">{t("account.migration.notice")}</p>
                </>
            )}
        </Card>
    );
}
