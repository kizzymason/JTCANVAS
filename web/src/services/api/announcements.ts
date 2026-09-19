import { apiClient, apiDelete, apiGet, apiPatch, apiPost, type Paginated } from "./client";

export const JOIN_COMMUNITY_SLUG = "join-community";

export type AnnouncementSummary = {
    id: string;
    slug: string;
    title: string;
    pinned: boolean;
    publishedAt: string;
    updatedAt: string;
};

export type AnnouncementDetail = AnnouncementSummary & { content: string };

export type AdminAnnouncement = {
    id: string;
    slug: string;
    title: string;
    content: string;
    published: boolean;
    pinned: boolean;
    sortOrder: number;
    publishedAt: string | null;
    createdAt: string;
    updatedAt: string;
    locked: boolean;
};

export type AnnouncementWriteBody = {
    title: string;
    content: string;
    slug?: string;
    published?: boolean;
    pinned?: boolean;
    sortOrder?: number;
};

export const announcementsApi = {
    list: () => apiGet<{ items: AnnouncementSummary[] }>("/announcements"),
    detail: (idOrSlug: string) => apiGet<AnnouncementDetail>(`/announcements/${encodeURIComponent(idOrSlug)}`),
};

export const adminAnnouncementsApi = {
    list: (params: { page: number; pageSize: number; keyword?: string }) => apiGet<Paginated<AdminAnnouncement>>("/admin/announcements", { params }),
    create: (body: AnnouncementWriteBody) => apiPost<AdminAnnouncement>("/admin/announcements", body),
    update: (id: string, body: AnnouncementWriteBody) => apiPatch<AdminAnnouncement>(`/admin/announcements/${id}`, body),
    remove: (id: string) => apiDelete<{ id: string }>(`/admin/announcements/${id}`),
    uploadImage: async (file: File) => {
        const form = new FormData();
        form.append("file", file);
        const response = await apiClient.post<{ url: string; storageKey: string }>("/admin/announcements/images", form);
        return response.data;
    },
};
