import { create } from "zustand";

import { JOIN_COMMUNITY_SLUG } from "@/services/api/announcements";

type AnnouncementView = { kind: "closed" } | { kind: "list" } | { kind: "detail"; idOrSlug: string; fromList: boolean };

type AnnouncementStore = {
    view: AnnouncementView;
    openList: () => void;
    openDetail: (idOrSlug: string, fromList?: boolean) => void;
    openJoinCommunity: () => void;
    backToList: () => void;
    close: () => void;
};

export const useAnnouncementStore = create<AnnouncementStore>((set) => ({
    view: { kind: "closed" },
    openList: () => set({ view: { kind: "list" } }),
    openDetail: (idOrSlug, fromList = false) => set({ view: { kind: "detail", idOrSlug, fromList } }),
    openJoinCommunity: () => set({ view: { kind: "detail", idOrSlug: JOIN_COMMUNITY_SLUG, fromList: false } }),
    backToList: () => set({ view: { kind: "list" } }),
    close: () => set({ view: { kind: "closed" } }),
}));
