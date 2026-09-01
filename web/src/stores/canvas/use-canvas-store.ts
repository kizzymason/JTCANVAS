import { create } from "zustand";

import i18n from "@/i18n";
import { createProject as createProjectRequest, deleteProjects as deleteProjectsRequest, fetchProject, fetchProjects, saveProject } from "@/services/api/content";
import { ApiError } from "@/services/api/client";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
    /** Server optimistic-lock version. Bumped on every accepted save. */
    version: number;
};

type CanvasStore = {
    hydrated: boolean;
    /** Loaded project summaries plus any project fully opened this session. */
    projects: CanvasProject[];
    saving: boolean;
    /** Set when the server rejected a save because another device wrote first. */
    conflictProjectId: string | null;

    loadProjects: () => Promise<void>;
    createProject: (title?: string) => Promise<string>;
    importProject: (project: Partial<CanvasProject>) => Promise<string>;
    /** Fetches full project data from the server and caches it locally. */
    openProject: (id: string) => Promise<CanvasProject | null>;
    getProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => Promise<void>;
    deleteProjects: (ids: string[]) => Promise<void>;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
    clearConflict: () => void;
    reset: () => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };

/**
 * Canvas edits are frequent; batching them keeps the server write rate sane while still feeling
 * instant locally. Node and connection changes flush after this delay.
 */
const SAVE_DEBOUNCE_MS = 1200;

/** Pure view state. Kept out of the payload so panning does not generate a server write. */
const VIEW_ONLY_KEYS = new Set(["viewport", "showImageInfo", "backgroundMode"]);

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingViewOnly = new Set<string>();

function toProject(record: { id: string; title: string; createdAt: string; updatedAt: string; version: number; data: Record<string, unknown> }): CanvasProject {
    const data = record.data ?? {};
    return {
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        version: record.version,
        nodes: (data.nodes as CanvasNodeData[]) ?? [],
        connections: (data.connections as CanvasConnection[]) ?? [],
        chatSessions: (data.chatSessions as CanvasAssistantSession[]) ?? [],
        activeChatId: (data.activeChatId as string | null) ?? null,
        backgroundMode: (data.backgroundMode as CanvasBackgroundMode) ?? "lines",
        showImageInfo: Boolean(data.showImageInfo),
        viewport: (data.viewport as ViewportTransform) ?? initialViewport,
    };
}

function toPayload(project: CanvasProject) {
    return {
        nodes: project.nodes,
        connections: project.connections,
        chatSessions: project.chatSessions,
        activeChatId: project.activeChatId,
        backgroundMode: project.backgroundMode,
        showImageInfo: project.showImageInfo,
        viewport: project.viewport,
    };
}

export const useCanvasStore = create<CanvasStore>()((set, get) => ({
    hydrated: false,
    projects: [],
    saving: false,
    conflictProjectId: null,

    loadProjects: async () => {
        try {
            const result = await fetchProjects({ page: 1, pageSize: 200 });
            // Summaries carry no `data`; keep any already-opened project's payload intact.
            set((state) => ({
                hydrated: true,
                projects: result.items.map((summary) => {
                    const existing = state.projects.find((project) => project.id === summary.id);
                    return existing ? { ...existing, title: summary.title, version: summary.version, updatedAt: summary.updatedAt } : toProject({ ...summary, data: {} });
                }),
            }));
        } catch (error) {
            set({ hydrated: true });
            throw error;
        }
    },

    createProject: async (title = i18n.t("canvas.project.untitled")) => {
        const record = await createProjectRequest({ title, data: { nodes: [], connections: [], chatSessions: [], viewport: initialViewport } });
        const project = toProject(record);
        set((state) => ({ projects: [project, ...state.projects] }));
        return project.id;
    },

    importProject: async (source) => {
        const record = await createProjectRequest({
            title: source.title || i18n.t("canvas.project.imported"),
            data: {
                nodes: source.nodes ?? [],
                connections: source.connections ?? [],
                chatSessions: source.chatSessions ?? [],
                activeChatId: source.activeChatId ?? null,
                backgroundMode: source.backgroundMode ?? "lines",
                showImageInfo: source.showImageInfo ?? false,
                viewport: source.viewport ?? initialViewport,
            },
        });
        const project = toProject(record);
        set((state) => ({ projects: [project, ...state.projects] }));
        return project.id;
    },

    openProject: async (id) => {
        try {
            const record = await fetchProject(id);
            const project = toProject(record);
            set((state) => ({ projects: state.projects.some((item) => item.id === id) ? state.projects.map((item) => (item.id === id ? project : item)) : [project, ...state.projects] }));
            return project;
        } catch {
            return null;
        }
    },

    getProject: (id) => get().projects.find((item) => item.id === id) || null,

    renameProject: async (id, title) => {
        const project = get().getProject(id);
        if (!project) return;
        const next = title.trim() || project.title;
        set((state) => ({ projects: state.projects.map((item) => (item.id === id ? { ...item, title: next } : item)) }));
        const record = await saveProject(id, { version: project.version, title: next });
        set((state) => ({ projects: state.projects.map((item) => (item.id === id ? { ...item, version: record.version, updatedAt: record.updatedAt } : item)) }));
    },

    deleteProjects: async (ids) => {
        await deleteProjectsRequest(ids);
        for (const id of ids) {
            const timer = saveTimers.get(id);
            if (timer) clearTimeout(timer);
            saveTimers.delete(id);
        }
        set((state) => ({ projects: state.projects.filter((project) => !ids.includes(project.id)) }));
    },

    /** Applies the change locally at once and schedules a debounced server save. */
    updateProject: (id, patch) => {
        set((state) => ({
            projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
        }));

        const onlyViewState = Object.keys(patch).every((key) => VIEW_ONLY_KEYS.has(key));
        if (onlyViewState) {
            // Ride along with the next real save instead of triggering one; panning must not hit the server.
            pendingViewOnly.add(id);
            return;
        }

        const existing = saveTimers.get(id);
        if (existing) clearTimeout(existing);
        saveTimers.set(
            id,
            setTimeout(() => {
                saveTimers.delete(id);
                pendingViewOnly.delete(id);
                void flush(id, set, get);
            }, SAVE_DEBOUNCE_MS),
        );
    },

    clearConflict: () => set({ conflictProjectId: null }),

    reset: () => {
        for (const timer of saveTimers.values()) clearTimeout(timer);
        saveTimers.clear();
        pendingViewOnly.clear();
        set({ projects: [], hydrated: false, conflictProjectId: null });
    },
}));

async function flush(id: string, set: (partial: Partial<CanvasStore>) => void, get: () => CanvasStore) {
    const project = get().getProject(id);
    if (!project) return;
    set({ saving: true });
    try {
        const record = await saveProject(id, { version: project.version, data: toPayload(project) });
        useCanvasStore.setState((state) => ({
            projects: state.projects.map((item) => (item.id === id ? { ...item, version: record.version, updatedAt: record.updatedAt } : item)),
        }));
    } catch (error) {
        // A stale version means another tab or device saved first; surface it rather than clobbering.
        if (error instanceof ApiError && error.code === "VERSION_CONFLICT") set({ conflictProjectId: id });
        else throw error;
    } finally {
        set({ saving: false });
    }
}

/** Forces any pending debounced save to run now. Called before navigating away from a canvas. */
export async function flushCanvasSaves() {
    const ids = [...saveTimers.keys()];
    for (const id of ids) {
        const timer = saveTimers.get(id);
        if (timer) clearTimeout(timer);
        saveTimers.delete(id);
        await flush(id, (partial) => useCanvasStore.setState(partial), useCanvasStore.getState).catch(() => undefined);
    }
}
