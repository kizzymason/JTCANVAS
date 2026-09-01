import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button } from "antd";
import { Check, CheckSquare, Download, FileUp, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readZip } from "@/lib/zip";
import { uploadFile } from "@/services/api/files";
import { remapStorageKeys } from "@/lib/canvas/storage-key-remap";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { hasAgentUrlBootstrap } from "@/lib/agent/agent-url-bootstrap";

export default function CanvasPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const [importing, setImporting] = useState(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const loadProjects = useCanvasStore((state) => state.loadProjects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const clearSelectedIds = useCanvasUiStore((state) => state.clearSelectedProjectIds);
    const [selecting, setSelecting] = useState(false);

    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);

    const finishSelecting = () => {
        setSelecting(false);
        clearSelectedIds();
        stopEditing();
    };

    useEffect(() => {
        if (!selecting) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            finishSelecting();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [selecting]);

    useEffect(() => {
        if (selecting && hydrated && !projects.length) finishSelecting();
    }, [hydrated, projects.length, selecting]);

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        const agentHash = hasAgentUrlBootstrap(window.location.hash) ? window.location.hash : "";
        navigate(`/canvas/${id}${agentQuery}${agentHash}`, { replace: Boolean(agentHash) });
    };
    const createAndEnter = async () => enterProject(await createProject(t("canvas.defaultTitle", { count: projects.length + 1 })));

    const importCanvas = async (file?: File) => {
        if (!file) return;
        setImporting(true);
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;

            for (const item of data.projects) {
                // Files have to be re-uploaded because the server issues its own storage keys.
                const mapping = new Map<string, string>();
                for (const asset of item.files) {
                    const blob = zip.get(asset.path);
                    if (!blob) continue;
                    const typedBlob = blob.type ? blob : blob.slice(0, blob.size, asset.mimeType);
                    const stored = await uploadFile(typedBlob, asset.path.split("/").pop() || "import.bin");
                    mapping.set(asset.storageKey, stored.storageKey);
                }
                await importProject(remapStorageKeys(item.project, mapping));
            }
            message.success(t("canvas.imported", { count: data.projects.length }));
        } catch {
            message.error(t("canvas.importFailed"));
        } finally {
            setImporting(false);
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    // Projects live on the server now, so the list has to be fetched on mount.
    useEffect(() => {
        void loadProjects().catch(() => {
            message.error(t("canvas.loadFailed"));
        });
    }, [loadProjects, message, t]);

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        const open = async () => {
            const existing = mode === "recent" ? projects[0]?.id : undefined;
            enterProject(existing ?? (await createProject(t("canvas.defaultTitle", { count: projects.length + 1 }))));
        };
        void open();
    }, [createProject, hydrated, mode, projects, t]);

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">{t("canvas.opening")}</main>;

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <div>
                        <h1 className="text-3xl font-semibold">{t("canvas.title")}</h1>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {selecting ? (
                            <>
                                <Button
                                    type="primary"
                                    disabled={!hydrated || !projects.length}
                                    className="!border-neutral-950 !bg-neutral-950 !text-white hover:!border-black hover:!bg-black disabled:!border-neutral-400 disabled:!bg-neutral-400 disabled:!text-white dark:disabled:!border-neutral-600 dark:disabled:!bg-neutral-600"
                                    onClick={() => setDeleteIds(projects.map((project) => project.id))}
                                >
                                    {t("canvas.deleteAll")}
                                </Button>
                                <Button disabled={!hydrated || !selectedIds.length} icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects(projects.filter((project) => selectedIds.includes(project.id)), `${t("canvas.title")}-${selectedIds.length}`)}>
                                    {t("canvas.exportSelected")}
                                </Button>
                                <Button disabled={!hydrated || !selectedIds.length} icon={<Trash2 className="size-4" />} onClick={() => setDeleteIds(selectedIds)}>
                                    {t("canvas.deleteSelected")}
                                </Button>
                                <Button
                                    disabled={!hydrated}
                                    icon={<Check className="size-4" />}
                                    className="!border-emerald-800 !bg-emerald-800 !text-white hover:!border-emerald-950 hover:!bg-emerald-950 disabled:!border-emerald-800/40 disabled:!bg-emerald-800/40 disabled:!text-white"
                                    onClick={finishSelecting}
                                >
                                    {t("canvas.finishSelect")}
                                </Button>
                            </>
                        ) : (
                            <>
                                {projects.length ? (
                                    <Button
                                        disabled={!hydrated}
                                        icon={<CheckSquare className="size-4" />}
                                        onClick={() => {
                                            stopEditing();
                                            setSelecting(true);
                                        }}
                                    >
                                        {t("canvas.selectProjects")}
                                    </Button>
                                ) : null}
                                <Button disabled={!hydrated} loading={importing} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                                    {t("canvas.import")}
                                </Button>
                                <Button disabled={!hydrated} type="primary" icon={<Plus className="size-4" />} onClick={() => void createAndEnter()}>
                                    {t("canvas.create")}
                                </Button>
                            </>
                        )}
                    </div>
                </header>

                {!hydrated ? (
                    <section className="flex min-h-[360px] items-center justify-center border-y border-stone-200 text-sm text-stone-500 dark:border-stone-800">{t("canvas.loading")}</section>
                ) : projects.length ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,220px))] gap-4">
                        {projects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} selecting={selecting} />
                        ))}
                    </div>
                ) : (
                    <section className="flex min-h-[360px] flex-col items-center justify-center border-y border-stone-200 text-center dark:border-stone-800">
                        <h2 className="text-xl font-medium">{t("canvas.empty")}</h2>
                        <p className="mt-3 text-sm text-stone-500">{t("canvas.emptyDescription")}</p>
                        <Button type="primary" className="mt-6" icon={<Plus className="size-4" />} onClick={() => void createAndEnter()}>
                            {t("canvas.create")}
                        </Button>
                    </section>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
