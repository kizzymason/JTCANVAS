import { apiClient, apiGet } from "./client";

export type HomeMedia = { source: "brand" | "upload"; key: string };
export type HomeConfig = {
    hero: { title: string; subtitle: string; visible: boolean; media: HomeMedia | null };
    entries: Array<{ kind: "image" | "video" | "canvas"; title: string; description: string; visible: boolean; media: HomeMedia | null }>;
};
export type HomeWorkInput = { title: string; category: string; kind: "image" | "video"; prompt: string; media: HomeMedia; poster: HomeMedia | null; published: boolean; sortOrder: number };
export type HomeWork = HomeWorkInput & { id: string };
export type PublicMedia = { url: string; thumbUrl: string; mediumUrl: string };
export type PublicWork = { id: string; title: string; category: string; kind: "image" | "video"; prompt: string; media: PublicMedia; poster: PublicMedia | null; sortOrder: number };
export type PublicHome = {
    config: { hero: { title: string; subtitle: string; media: PublicMedia | null } | null; entries: Array<{ kind: "image" | "video" | "canvas"; title: string; description: string; media: PublicMedia | null }> } | null;
    works: PublicWork[];
};
export type PublicHomeConfig = Pick<PublicHome, "config">;
export type PublicHomeWorks = Pick<PublicHome, "works">;
export const homepageApi = {
    get: () => apiGet<PublicHome>("/homepage"),
    getConfig: () => apiGet<PublicHomeConfig>("/homepage/config"),
    getWorks: () => apiGet<PublicHomeWorks>("/homepage/works"),
    work: (id: string) => apiGet<PublicWork>(`/homepage/works/${encodeURIComponent(id)}`),
    admin: () => apiGet<{ initialized: boolean; config: HomeConfig | null; works: HomeWork[] }>("/admin/homepage"),
    save: async (config: HomeConfig) => (await apiClient.patch("/admin/homepage", config)).data,
    initialize: async () => (await apiClient.post("/admin/homepage/initialize")).data,
    saveWork: async (id: string | undefined, work: HomeWorkInput) => (await (id ? apiClient.patch(`/admin/homepage/works/${id}`, work) : apiClient.post("/admin/homepage/works", work))).data,
    remove: async (id: string) => (await apiClient.delete(`/admin/homepage/works/${id}`)).data,
};
