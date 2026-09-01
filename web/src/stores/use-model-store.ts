import { create } from "zustand";

import { fetchModels, type ModelCapability, type PublicModel } from "@/services/api/models";

type ModelStore = {
    loaded: boolean;
    loading: boolean;
    models: PublicModel[];
    load: (force?: boolean) => Promise<void>;
    byCapability: (capability: ModelCapability) => PublicModel[];
    find: (value: string) => PublicModel | undefined;
    reset: () => void;
};

/**
 * The catalogue of models the platform offers, with prices attached. Fetched once after login and
 * reused everywhere, so the workbench can show a live price estimate without a round-trip per
 * keystroke. The server recomputes the authoritative cost when a task is submitted.
 */
export const useModelStore = create<ModelStore>()((set, get) => ({
    loaded: false,
    loading: false,
    models: [],

    load: async (force = false) => {
        if (get().loading || (get().loaded && !force)) return;
        set({ loading: true });
        try {
            const result = await fetchModels();
            set({ models: result.models, loaded: true });
        } catch {
            // Leave the list empty; callers surface "no usable model" rather than a hard failure.
            set({ loaded: true });
        } finally {
            set({ loading: false });
        }
    },

    byCapability: (capability) => get().models.filter((model) => model.capability === capability),

    find: (value) => get().models.find((model) => model.value === value),

    reset: () => set({ models: [], loaded: false }),
}));
