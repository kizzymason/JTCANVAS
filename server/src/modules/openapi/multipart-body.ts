import type { FastifyReply, FastifyRequest } from "fastify";
import { invalidRequest, OpenAiApiError } from "./openai-errors";

/** Runs before guards/interceptors so idempotency hashes file bytes and all parsed fields. */
export async function parseOpenApiMultipart(request: FastifyRequest, reply: FastifyReply) {
    const path = request.url.split("?")[0];
    if (request.method !== "POST" || !/^\/api\/v1\/(?:videos(?:\/generations)?|video\/generations|images\/(?:generations|edits))\/?$/.test(path ?? "") || !request.isMultipart()) return;
    try {
        await readMultipart(request);
    } catch (error) {
        // Fastify hooks run outside the controller exception filter.
        if (error instanceof OpenAiApiError) return reply.code(error.getStatus()).send(error.getResponse());
        const status = (error as { statusCode?: number })?.statusCode;
        if (status && status >= 400 && status < 500) return reply.code(status).send({ error: { type: "invalid_request_error", code: "invalid_multipart", param: null, message: "Multipart request is invalid or exceeds the upload limits." } });
        throw error;
    }
}

async function readMultipart(request: FastifyRequest) {
    const body: Record<string, unknown> = {};
    const images: string[] = [];
    const inputs: Array<{ image_url: string }> = [];
    const jsonFields = new Set(["metadata", "image", "image_urls", "images", "input_reference", "reference_images", "videos", "reference_videos", "audios", "reference_audios"]);
    const booleans = new Set(["watermark", "generate_audio", "camera_fixed", "web_search"]);
    for await (const part of request.parts()) {
        const name = part.fieldname.replace(/\[\]$/, "");
        if (part.type === "file") {
            if (!["image", "input_reference", "mask"].includes(name) || !["image/png", "image/jpeg", "image/webp"].includes(part.mimetype)) {
                throw invalidRequest("Only PNG/JPEG/WebP files in image, mask or input_reference are supported; send video/audio references as URLs.", "invalid_reference", name);
            }
            const bytes = await part.toBuffer();
            const url = `data:${part.mimetype};base64,${bytes.toString("base64")}`;
            if (name === "image") images.push(url);
            else if (name === "input_reference") inputs.push({ image_url: url });
            else {
                if (body.mask !== undefined) throw invalidRequest("mask must be provided once.", "duplicate_parameter", name);
                body.mask = url;
            }
            continue;
        }
        if (body[name] !== undefined) throw invalidRequest(`${name} must be provided once; use a JSON array.`, "duplicate_parameter", name);
        let value: unknown = part.value;
        if (typeof value === "string" && (name === "metadata" || (jsonFields.has(name) && /^[\[{]/.test(value.trim())))) {
            try { value = JSON.parse(value); } catch { throw invalidRequest(`${name} contains invalid JSON.`, "invalid_json", name); }
        }
        if (booleans.has(name) && (value === "true" || value === "false")) value = value === "true";
        if (name === "seed" && typeof value === "string" && /^-?\d+$/.test(value)) value = Number(value);
        body[name] = value;
    }
    if (images.length) {
        if (body.image !== undefined) throw invalidRequest("Do not mix image files and image fields.", "conflicting_parameters", "image");
        body.image = images;
    }
    if (inputs.length) {
        if (body.input_reference !== undefined) throw invalidRequest("Do not mix input_reference files and fields.", "conflicting_parameters", "input_reference");
        body.input_reference = inputs;
    }
    request.body = body;
}
