import type { Capability } from "../../pricing/pricing.types";
import type { AspectPreset } from "../../pricing/aspect-presets";

/** A reference image already resolved to bytes by the worker. */
export type ReferenceInput = {
    storageKey: string;
    mimeType: string;
    fileName: string;
    body: Buffer;
    /** Public http(s) URL Seedream can fetch. Empty-body passthrough refs only carry this. */
    publicUrl?: string;
};

export type GenerationRequest = {
    capability: Capability;
    /** Bare upstream model name, channel prefix already stripped. */
    model: string;
    prompt: string;
    /** Prompt prefix configured per channel model, prepended by the worker. */
    systemPrompt?: string;
    references: ReferenceInput[];
    mask?: ReferenceInput;
    count: number;
    /** "1024x1024", "16:9" or "auto". */
    size?: string;
    quality?: string;
    background?: string;
    /** Per-model 1K/2K/4K pixel table used to turn a ratio into an explicit size. */
    aspectPresets?: AspectPreset[];
    seconds?: number;
    resolution?: string;
    generateAudio?: boolean;
    watermark?: boolean;
    voice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    reasoningEffort?: string;
    signal?: AbortSignal;
};

export type ProviderCredentials = {
    baseUrl: string;
    apiKey: string;
};

export type GeneratedBinary = {
    body: Buffer;
    mimeType: string;
};

export type GenerationOutput = {
    /** Images, video or audio produced by the call. */
    binaries: GeneratedBinary[];
    /** Text produced by a text-capability call. */
    text?: string;
    /** Actual billable units, when the provider reports something different from the request. */
    actualQuantity?: number;
    providerTaskId?: string;
};

/** Streaming callback for text generation; the worker forwards each chunk over Redis pub/sub. */
export type DeltaSink = (chunk: string) => void;

/**
 * One implementation per upstream dialect. Registered by DI token so business code never branches
 * on apiFormat, and a new provider is a new class plus one module entry.
 */
export abstract class ProviderAdapter {
    abstract readonly format: "openai" | "gemini" | "piapi";
    abstract supports(capability: Capability): boolean;
    abstract generate(credentials: ProviderCredentials, request: GenerationRequest, onDelta?: DeltaSink): Promise<GenerationOutput>;
}

export const PROVIDER_ADAPTERS = Symbol("PROVIDER_ADAPTERS");
