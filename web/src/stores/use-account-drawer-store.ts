import { create } from "zustand";

type AccountDrawerStore = {
    isOpen: boolean;
    open: () => void;
    close: () => void;
};

export const useAccountDrawerStore = create<AccountDrawerStore>((set) => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
}));
