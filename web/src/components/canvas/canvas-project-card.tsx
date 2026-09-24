import { Check, Download, Pencil, Trash2, Workflow, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Input } from "antd";
import { useTranslation } from "react-i18next";

import { InvertedSurface } from "@/components/inverted-surface";
import { fileUrl } from "@/services/api/files";
import { cn } from "@/lib/utils";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { hasAgentUrlBootstrap } from "@/lib/agent/agent-url-bootstrap";

export function CanvasProjectCard({ project, selecting }: { project: CanvasProject; selecting: boolean }) {
    const { i18n, t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const renameProject = useCanvasStore((state) => state.renameProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const editing = editingId === project.id;
    const selected = selectedIds.includes(project.id);
    const imageNode = project.nodes.find((node) => node.type === "image" && (node.metadata?.storageKey || node.metadata?.content));
    const cover = imageNode?.metadata?.storageKey ? fileUrl(imageNode.metadata.storageKey, "thumb") : imageNode?.metadata?.content;

    const open = () => {
        const agentHash = hasAgentUrlBootstrap(window.location.hash) ? window.location.hash : "";
        navigate(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}${agentHash}`, { replace: Boolean(agentHash) });
    };
    const saveTitle = () => {
        renameProject(project.id, editingTitle);
        stopEditing();
    };
    const activate = () => {
        if (editing) return;
        if (selecting) {
            toggleSelected(project.id, !selected);
            return;
        }
        open();
    };

    return (
        <InvertedSurface
            as="article"
            role={selecting ? "checkbox" : undefined}
            aria-checked={selecting ? selected : undefined}
            tabIndex={0}
            className={cn(
                "cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary",
                selected && selecting && "ring-1 ring-primary",
            )}
            innerClassName="flex flex-col"
            onClick={activate}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                event.preventDefault();
                activate();
            }}
        >
            {selecting && selected ? (
                <span className="absolute right-3 top-3 z-20 inline-flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <Check className="size-3.5" strokeWidth={2.5} />
                </span>
            ) : null}

            <div className="flex aspect-[16/10] items-center justify-center overflow-hidden border-b border-border bg-background">
                {cover ? <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" /> : <Workflow className="size-12 text-primary/50" strokeWidth={1} />}
            </div>
            <div className="flex flex-1 flex-col justify-between gap-5 p-4">
                <div className="min-w-0">
                    {editing ? (
                        <Input className="min-w-0" value={editingTitle} onClick={(event) => event.stopPropagation()} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveTitle()} autoFocus />
                    ) : (
                        <div className="min-w-0">
                            <h2 className="truncate text-base font-semibold tracking-tight">{project.title}</h2>
                            <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                {t("canvas.project.stats", { nodes: project.nodes.length, connections: project.connections.length })}
                            </p>
                        </div>
                    )}
                </div>
                <div className="flex flex-wrap items-end justify-between gap-2">
                    <p className="text-xs text-muted-foreground">{t("canvas.project.updated", { date: new Date(project.updatedAt).toLocaleString(i18n.resolvedLanguage, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) })}</p>
                    {selecting ? null : (
                        <div className="flex items-center gap-1 text-current" onClick={(event) => event.stopPropagation()}>
                            {editing ? (
                                <>
                                    <Button type="text" size="small" shape="circle" className="!text-current hover:!bg-white/10" icon={<Check className="size-4" />} onClick={saveTitle} aria-label={t("canvas.project.saveName")} />
                                    <Button type="text" size="small" shape="circle" className="!text-current hover:!bg-white/10" icon={<X className="size-4" />} onClick={stopEditing} aria-label={t("canvas.project.cancelRename")} />
                                </>
                            ) : (
                                <>
                                    <Button type="text" size="small" shape="circle" className="!text-current hover:!bg-white/10" icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects([project], project.title || t("canvas.title"))} aria-label={t("canvas.project.export")} />
                                    <Button type="text" size="small" shape="circle" className="!text-current hover:!bg-white/10" icon={<Pencil className="size-4" />} onClick={() => startEditing(project.id, project.title)} aria-label={t("canvas.project.rename")} />
                                    <Button type="text" size="small" shape="circle" className="!text-current hover:!bg-white/10" icon={<Trash2 className="size-4" />} onClick={() => setDeleteIds([project.id])} aria-label={t("canvas.project.delete")} />
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </InvertedSurface>
    );
}
