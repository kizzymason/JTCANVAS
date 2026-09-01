import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_PIAPI_IMAGE_MODEL } from "@/lib/piapi/piapi-models";
import { updatePreferences } from "@/services/api/account";
import type { ModelCapability, PublicModel } from "@/services/api/models";
import { useModelStore } from "@/stores/use-model-store";

export type { ModelCapability } from "@/services/api/models";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";

/**
 * Generation preferences only.
 *
 * Provider channels, API keys and request scripts used to live here and were sent straight from the
 * browser. They are now server-side and admin-managed: the frontend never sees a credential, and
 * this store holds nothing but the user's own defaults plus which model they picked.
 */
export type AiConfig = {
    /** `channelId::modelName` values, chosen from the server's model list. */
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
};

export type ConfigTabKey = "preferences" | "generation";

export const defaultConfig: AiConfig = {
    model: "",
    imageModel: "",
    videoModel: "",
    textModel: "",
    audioModel: "",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "4",
    vquality: "720p",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    reasoningEffort: "auto",
    quality: "auto",
    size: "auto",
    background: "auto",
    count: "1",
    canvasImageCount: "1",
};

export const CONFIG_STORE_KEY = "infinite-canvas:preferences_store";
const CHANNEL_MODEL_SEPARATOR = "::";

type ConfigStore = {
    config: AiConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    replaceConfig: (config: Partial<AiConfig>) => void;
    /** First argument is retained for call-site compatibility; it no longer changes behaviour. */
    openConfigDialog: (promptContinue?: boolean, tab?: ConfigTabKey) => void;
    closeConfigDialog: () => void;
    /** True when the chosen model exists in the server's list. Balance is checked at submit time. */
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
};

let syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Preferences follow the account, so they are mirrored to the server after a short debounce. */
function scheduleSync(config: AiConfig) {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        syncTimer = null;
        void updatePreferences(config as unknown as Record<string, unknown>).catch(() => undefined);
    }, 1500);
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            isConfigOpen: false,
            configTab: "preferences",

            updateConfig: (key, value) => {
                set((state) => ({ config: { ...state.config, [key]: value } }));
                scheduleSync(get().config);
            },

            replaceConfig: (config) => {
                set((state) => ({ config: { ...state.config, ...config } }));
            },

            openConfigDialog: (_promptContinue, tab = "preferences") => set({ isConfigOpen: true, configTab: tab }),
            closeConfigDialog: () => set({ isConfigOpen: false }),

            isAiConfigReady: (_config, model) => {
                const value = model.trim();
                if (!value) return false;
                return useModelStore.getState().models.some((item) => item.value === value || item.modelName === modelOptionName(value));
            },
        }),
        {
            name: CONFIG_STORE_KEY,
            // Preferences are small and non-authoritative, so localStorage is the right home for them.
            partialize: (state) => ({ config: state.config }),
        },
    ),
);

/**
 * The config actually used for a request. Previously this collapsed a channel into base URL and key;
 * now it just fills in the per-capability model default, since credentials are server-side.
 */
export function useEffectiveConfig() {
    return useConfigStore((state) => state.config);
}

export function boolConfig(value: string | boolean | undefined, fallback = false) {
    if (value === undefined || value === "") return fallback;
    if (typeof value === "boolean") return value;
    return value === "true" || value === "1";
}

/** Strips the `channelId::` prefix, leaving the bare upstream model name. */
export function modelOptionName(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    return index < 0 ? value : value.slice(index + CHANNEL_MODEL_SEPARATOR.length);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

/** Display label: the admin-configured display name when known, else the bare model name. */
export function modelOptionLabel(value: string) {
    const model = useModelStore.getState().models.find((item) => item.value === value);
    return model?.displayName || modelOptionName(value);
}

/** Drops a saved selection whose model no longer exists, and upgrades a bare name to a full value. */
export function normalizeModelOptionValue(value: string, models: PublicModel[]) {
    if (!value.trim()) return "";
    const exact = models.find((item) => item.value === value);
    if (exact) return exact.value;
    const byName = models.find((item) => item.modelName === modelOptionName(value));
    return byName ? byName.value : "";
}

/** `config` is unused now that models come from the server, but kept so call sites stay unchanged. */
export function selectableModelsByCapability(_config: AiConfig | undefined, capability: ModelCapability) {
    return useModelStore
        .getState()
        .models.filter((model) => model.capability === capability)
        .map((model) => model.value);
}

/**
 * Keeps a node's own model when it matches the requested capability, otherwise falls back to the
 * user's default for that capability, then to PiAPI Seedream for images, then to the first offer.
 */
export function resolveModelForCapability(config: AiConfig, preferred: string | undefined, capability: ModelCapability) {
    const models = useModelStore.getState().models;
    const usable = (value: string | undefined) => {
        if (!value) return false;
        const item = models.find((model) => model.value === value && model.capability === capability);
        return Boolean(item) && !isSmokeTestModel(item);
    };

    if (usable(preferred)) return preferred!;
    const fallbackKey = capability === "image" ? "imageModel" : capability === "video" ? "videoModel" : capability === "audio" ? "audioModel" : "textModel";
    const configured = config[fallbackKey];
    if (usable(configured)) return configured;
    if (capability === "image") {
        const piapiDefault = models.find((item) => item.capability === "image" && item.apiFormat === "piapi" && item.modelName === DEFAULT_PIAPI_IMAGE_MODEL);
        if (piapiDefault) return piapiDefault.value;
        const anyPiapi = models.find((item) => item.capability === "image" && item.apiFormat === "piapi");
        if (anyPiapi) return anyPiapi.value;
    }
    return models.find((item) => item.capability === capability && !isSmokeTestModel(item))?.value ?? models.find((item) => item.capability === capability)?.value ?? "";
}

/**
 * After the catalogue loads, keep a still-valid saved image model, otherwise pick PiAPI Seedream.
 * Must run after persist rehydration so a stored choice is not overwritten by the empty default.
 * The smoke-image fixture is ignored so it cannot steal the default after PiAPI is restored.
 */
export function applyDefaultImageModel() {
    const models = useModelStore.getState().models.filter((item) => item.capability === "image");
    if (!models.length) return;

    const store = useConfigStore.getState();
    const current = normalizeModelOptionValue(store.config.imageModel || store.config.model, models);
    const currentModel = models.find((item) => item.value === current);
    if (current && currentModel && !isSmokeTestModel(currentModel)) {
        if (current !== store.config.imageModel) store.updateConfig("imageModel", current);
        return;
    }

    const preferred =
        models.find((item) => item.apiFormat === "piapi" && item.modelName === DEFAULT_PIAPI_IMAGE_MODEL) ??
        models.find((item) => item.apiFormat === "piapi") ??
        models.find((item) => !isSmokeTestModel(item)) ??
        models[0];
    if (preferred) store.updateConfig("imageModel", preferred.value);
}

function isSmokeTestModel(model: { modelName: string } | undefined) {
    return model?.modelName === "smoke-image";
}

export function guessCapability(model: string): ModelCapability {
    const found = useModelStore.getState().models.find((item) => item.value === model || item.modelName === modelOptionName(model));
    return found?.capability ?? "image";
}
