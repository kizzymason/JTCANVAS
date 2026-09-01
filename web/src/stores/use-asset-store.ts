import { create } from "zustand";

import { createAsset, deleteAssets, fetchAssets, updateAsset, type AssetKind, type AssetRecord, type AssetWriteBody } from "@/services/api/content";
import { fileUrl } from "@/services/api/files";

export type { AssetKind } from "@/services/api/content";

/**
 * Asset shape used by the UI. `coverUrl` and `data.dataUrl` are derived display URLs; only the file
 * ids and storage keys are authoritative, and they live on the server.
 */
export type Asset = {
    id: string;
    kind: AssetKind;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
    fileId: string | null;
    coverFileId: string | null;
    data: {
        content: string;
        storageKey?: string;
        dataUrl: string;
        url: string;
        width: number;
        height: number;
        bytes: number;
        mimeType: string;
    };
};

/** Image-specific narrowing kept for callers that only handle image assets. */
export type ImageAsset = Asset & { kind: "image" };

/**
 * Accepts the shape call sites already build (cover URL plus a `data` blob descriptor) and translates
 * it into the server DTO, so adding an asset did not have to change everywhere.
 */
export type NewAssetInput = {
    kind: AssetKind;
    title: string;
    coverUrl?: string;
    tags?: string[];
    source?: string;
    note?: string;
    metadata?: Record<string, unknown>;
    data?: {
        content?: string;
        storageKey?: string;
        dataUrl?: string;
        url?: string;
        width?: number;
        height?: number;
        bytes?: number;
        mimeType?: string;
    };
};

type AssetStore = {
    hydrated: boolean;
    loading: boolean;
    assets: Asset[];
    total: number;
    loadAssets: (query?: { page?: number; pageSize?: number; kind?: AssetKind; keyword?: string }) => Promise<void>;
    addAsset: (input: NewAssetInput) => Promise<string>;
    updateAsset: (id: string, patch: NewAssetInput) => Promise<void>;
    removeAsset: (id: string) => Promise<void>;
    removeAssets: (ids: string[]) => Promise<void>;
    reset: () => void;
};

function toAsset(record: AssetRecord): Asset {
    const storageKey = (record.metadata?.storageKey as string | undefined) ?? undefined;
    const url = storageKey ? fileUrl(storageKey) : "";
    return {
        id: record.id,
        kind: record.kind,
        title: record.title,
        // Thumbnails keep the library grid light; the original is only fetched on preview.
        coverUrl: storageKey ? fileUrl(storageKey, "thumb") : "",
        tags: record.tags ?? [],
        source: record.source,
        note: record.note,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        metadata: record.metadata,
        fileId: record.fileId,
        coverFileId: record.coverFileId,
        data: {
            content: record.content,
            storageKey,
            dataUrl: url,
            url,
            width: Number(record.metadata?.width ?? 0),
            height: Number(record.metadata?.height ?? 0),
            bytes: Number(record.metadata?.bytes ?? 0),
            mimeType: String(record.metadata?.mimeType ?? ""),
        },
    };
}

/**
 * The UI still builds `{ coverUrl, data }`; the API only accepts the DTO whitelist, so this strips
 * unknown fields and puts the file reference in `storageKey` + `metadata`.
 */
function toWriteBody(input: NewAssetInput): AssetWriteBody {
    const storageKey = input.data?.storageKey || (typeof input.metadata?.storageKey === "string" ? input.metadata.storageKey : undefined);
    return {
        kind: input.kind,
        title: input.title,
        content: input.data?.content ?? "",
        tags: input.tags ?? [],
        source: input.source ?? "",
        note: input.note ?? "",
        storageKey,
        metadata: {
            ...(input.metadata ?? {}),
            ...(storageKey ? { storageKey } : {}),
            ...(input.data?.width !== undefined ? { width: input.data.width } : {}),
            ...(input.data?.height !== undefined ? { height: input.data.height } : {}),
            ...(input.data?.bytes !== undefined ? { bytes: input.data.bytes } : {}),
            ...(input.data?.mimeType ? { mimeType: input.data.mimeType } : {}),
        },
    };
}

export const useAssetStore = create<AssetStore>()((set, get) => ({
    hydrated: false,
    loading: false,
    assets: [],
    total: 0,

    loadAssets: async (query) => {
        set({ loading: true });
        try {
            const result = await fetchAssets({ page: query?.page ?? 1, pageSize: query?.pageSize ?? 200, kind: query?.kind, keyword: query?.keyword });
            set({ assets: result.items.map(toAsset), total: result.total, hydrated: true });
        } catch (error) {
            set({ hydrated: true });
            throw error;
        } finally {
            set({ loading: false });
        }
    },

    addAsset: async (input) => {
        const record = await createAsset(toWriteBody(input));
        set((state) => ({ assets: [toAsset(record), ...state.assets], total: state.total + 1 }));
        return record.id;
    },

    updateAsset: async (id, patch) => {
        const record = await updateAsset(id, toWriteBody(patch));
        set((state) => ({ assets: state.assets.map((asset) => (asset.id === id ? toAsset(record) : asset)) }));
    },

    removeAsset: async (id) => {
        await get().removeAssets([id]);
    },

    removeAssets: async (ids) => {
        await deleteAssets(ids);
        set((state) => ({ assets: state.assets.filter((asset) => !ids.includes(asset.id)), total: Math.max(0, state.total - ids.length) }));
    },

    reset: () => set({ assets: [], total: 0, hydrated: false }),
}));
