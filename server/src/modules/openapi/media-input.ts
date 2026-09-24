import { ValidateBy } from "class-validator";
import { invalidRequest } from "./openai-errors";
import { isPublicHttpUrl } from "../storage/public-file-url";
import type { GenerationReferenceDto } from "../generation/dto/generation.dto";

type Kind = "image" | "video" | "audio";
const roles = ["first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"];
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Validate mixed URL/object arrays explicitly; unknown nested properties are never ignored. */
export function mediaReferences(value: unknown, kind?: Kind, param = "input_reference"): GenerationReferenceDto[] {
    if (value === undefined) return [];
    return (Array.isArray(value) ? value : [value]).map((item) => {
        let type: Kind = kind ?? "image";
        let url: unknown = item;
        let role: unknown;
        if (record(item)) {
            if (Object.keys(item).some((key) => !["url", "image_url", "video_url", "audio_url", "role", "type"].includes(key))) {
                throw invalidRequest(`Unknown reference field in ${param}.`, "invalid_reference", param);
            }
            const keys = ["url", "image_url", "video_url", "audio_url"].filter((key) => item[key] !== undefined);
            if (keys.length !== 1) throw invalidRequest(`${param} must contain exactly one URL.`, "invalid_reference", param);
            const key = keys[0]!;
            if (key !== "url") type = key.split("_")[0] as Kind;
            if (kind && type !== kind) throw invalidRequest(`${param} requires ${kind} references.`, "invalid_reference", param);
            url = item[key];
            if (record(url) && Object.keys(url).length === 1) url = url.url;
            role = item.role ?? (typeof item.type === "string" && roles.includes(item.type) ? item.type : undefined);
            if (item.type !== undefined && item.type !== `${type}_url` && item.type !== role) {
                throw invalidRequest(`Invalid reference type in ${param}.`, "invalid_reference", param);
            }
        }
        if (typeof url !== "string" || !url.trim()) throw invalidRequest(`${param} requires a non-empty URL.`, "invalid_reference", param);
        url = url.trim();
        if (!(isPublicHttpUrl(url as string) || (type === "image" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(url as string)))) {
            throw invalidRequest(`${param} requires a public http(s) URL or a base64 image data URL.`, "invalid_reference", param);
        }
        const allowed = type === "image" ? ["first_frame", "last_frame", "reference_image"] : [`reference_${type}`];
        if (role !== undefined && !allowed.includes(String(role))) throw invalidRequest(`Invalid ${type} role in ${param}.`, "invalid_reference", param);
        return { url: url as string, type, role: role as GenerationReferenceDto["role"] };
    });
}

export function IsMediaInput(kind?: Kind) {
    return ValidateBy({ name: "mediaInput", validator: {
        validate(value: unknown) { try { mediaReferences(value, kind); return true; } catch { return false; } },
        defaultMessage: () => "Reference must be a URL or an array of URL/reference objects with a valid media type and role",
    } });
}

export function videoContent(value: unknown) {
    if (!Array.isArray(value)) throw invalidRequest("content must be an array.", "invalid_content", "content");
    const texts: string[] = [];
    const references: GenerationReferenceDto[] = [];
    for (const part of value) {
        if (record(part) && part.type === "text") {
            if (Object.keys(part).some((key) => key !== "type" && key !== "text") || typeof part.text !== "string" || part.text.length > 20_000) {
                throw invalidRequest("Invalid text content.", "invalid_content", "content");
            }
            texts.push(part.text);
        } else {
            if (!record(part) || !["image_url", "video_url", "audio_url"].includes(String(part.type))) throw invalidRequest("Unsupported content type.", "invalid_content", "content");
            references.push(...mediaReferences(part, undefined, "content"));
        }
    }
    const prompt = texts.join("\n");
    if (prompt.length > 20_000) throw invalidRequest("Prompt exceeds 20000 characters.", "invalid_content", "content");
    return { prompt, references };
}

export function IsVideoContent() {
    return ValidateBy({ name: "videoContent", validator: {
        validate(value: unknown) { try { videoContent(value); return true; } catch { return false; } },
        defaultMessage: () => "content must contain text, image_url, video_url or audio_url parts with valid roles",
    } });
}

export function exclusiveAlias<T>(entries: Array<[string, T | undefined]>, normalize: (value: T) => unknown = (v) => v): T | undefined {
    const present = entries.filter((entry): entry is [string, T] => entry[1] !== undefined && entry[1] !== null);
    if (present.some(([, value]) => JSON.stringify(normalize(value)) !== JSON.stringify(normalize(present[0]![1])))) {
        throw invalidRequest(`Conflicting aliases: ${present.map(([key]) => key).join(", ")}.`, "conflicting_parameters", present[0]![0]);
    }
    return present[0]?.[1];
}
