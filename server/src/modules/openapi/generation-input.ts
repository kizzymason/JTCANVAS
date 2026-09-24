import type { PublicModel } from "../pricing/pricing.types";
import { normalizeImageResolution } from "../pricing/model-features";
import { normalizeQuality, pricingSpec, resolveRequestSize } from "../generation/image-size";
import { WHATSTOKEN_IMAGE_MODELS } from "../generation/whatstoken-catalog";
import { seedanceAspectRatio } from "../generation/provider/seedance-video";
import { normalizeVideoPricingResolution } from "../generation/video-pricing-spec";
import type { ImageGenerationDto, VideoCreateDto, VideoOptionsDto } from "./dto/openai.dto";
import { exclusiveAlias, mediaReferences, videoContent } from "./media-input";
import { invalidRequest } from "./openai-errors";
import { mapImageQuality, resolutionFromSize } from "./openai-mappers";

export function imageGenerationInput(body: ImageGenerationDto, model: PublicModel) {
    const rawSize = exclusiveAlias([["size", body.size], ["resolution", body.resolution]], (v) => v.toLowerCase());
    const ratio = exclusiveAlias([["ratio", body.ratio], ["aspect_ratio", body.aspect_ratio]]);
    let size = rawSize;
    let quality = mapImageQuality(body.quality);
    if (model.modelName.toLowerCase().includes("seedream") && rawSize && /^\d+x\d+$/i.test(rawSize) && quality && pricingSpec(quality, undefined) !== pricingSpec(undefined, rawSize, model.features.aspectPresets)) {
        throw invalidRequest("Pixel size and quality specify different resolution tiers.", "conflicting_parameters", "quality");
    }
    if (rawSize && /^[124]k$/i.test(rawSize)) {
        quality = exclusiveAlias([["size", rawSize], ["quality", body.quality === "auto" ? undefined : quality]], normalizeImageResolution);
        size = ratio ?? "auto";
    } else if (ratio) {
        if (size && size !== "auto" && seedanceAspectRatio(size) !== ratio) throw invalidRequest("size and ratio disagree.", "conflicting_parameters", "ratio");
        size = size && size !== "auto" ? size : ratio;
    }
    const catalogue = WHATSTOKEN_IMAGE_MODELS.find((item) => item.name === model.modelName);
    if (model.modelName.toLowerCase().includes("seedream")) {
        if (body.mask) throw invalidRequest("Seedream does not support mask edits; use image references and describe the edit in prompt.", "unsupported_parameter", "mask");
        const tiers = ["1K", "2K", "4K"].filter((tier) => model.features.resolutions.includes(tier as "1K" | "2K" | "4K") && (!catalogue || tier in catalogue.sizes));
        if (!tiers.length) throw invalidRequest("The model has no supported image resolution.", "resolution_unsupported", "size");
        const tier = pricingSpec(quality, size, model.features.aspectPresets) ?? catalogue?.defaultSize ?? tiers[0]!;
        // The documented compatibility policy: raise a lower tier without changing the aspect ratio.
        const effective = tiers.includes(tier) ? tier : tiers.find((item) => Number(item[0]) >= Number(tier[0]));
        if (!effective) throw invalidRequest(`Supported resolutions: ${tiers.join(", ")}.`, "resolution_unsupported", "size");
        if (effective !== tier && size && /^\d+x\d+$/i.test(size)) {
            size = resolveRequestSize(normalizeQuality(effective), seedanceAspectRatio(size), model.features.aspectPresets);
        }
        quality = effective;
    }
    const references = exclusiveAlias([["image", body.image], ["image_urls", body.image_urls]], (v) => mediaReferences(v, "image"));
    if (body.mask && !mediaReferences(references, "image").length) throw invalidRequest("mask requires an image reference.", "invalid_reference", "mask");
    return { size, quality, referenceMedia: mediaReferences(references, "image", "image"), mask: body.mask, watermark: body.watermark, webSearch: body.web_search };
}

export function videoGenerationInput(body: VideoCreateDto) {
    const option = <K extends keyof VideoOptionsDto>(key: K) => exclusiveAlias<VideoOptionsDto[K]>([[key, body[key]], [`metadata.${key}`, body.metadata?.[key]]]);
    const content = option("content") !== undefined ? videoContent(option("content")) : undefined;
    const prompt = exclusiveAlias([["prompt", body.prompt], ["content.text", content?.prompt || undefined]]);
    if (!prompt?.trim()) throw invalidRequest("prompt or content text is required.", "invalid_prompt", "prompt");
    const seconds = exclusiveAlias([["seconds", option("seconds")], ["duration", option("duration")]]) ?? 5;
    const rawSize = option("size");
    const tierInSize = rawSize && /^(480|720|768|1080|1440|2160)p?$|^[24]k$/i.test(rawSize) ? normalizeVideoPricingResolution(rawSize) : undefined;
    const resolution = exclusiveAlias([["resolution", option("resolution")], ["size", tierInSize]], normalizeVideoPricingResolution)
        ?? resolutionFromSize(rawSize) ?? "720";
    const ratio = exclusiveAlias([["ratio", option("ratio")], ["aspect_ratio", option("aspect_ratio")]]);
    if (ratio && rawSize && !tierInSize && rawSize !== "auto" && seedanceAspectRatio(rawSize) !== ratio) {
        throw invalidRequest("size and ratio disagree.", "conflicting_parameters", "ratio");
    }
    const imageAliases = ["image", "images", "image_urls", "reference_images"] as const;
    const imageInput = exclusiveAlias<unknown>(imageAliases.map((key) => [key, option(key)]), (v) => mediaReferences(v, "image"));
    const videoInput = exclusiveAlias<unknown>([["videos", option("videos")], ["reference_videos", option("reference_videos")]], (v) => mediaReferences(v, "video"));
    const audioInput = exclusiveAlias<unknown>([["audios", option("audios")], ["reference_audios", option("reference_audios")]], (v) => mediaReferences(v, "audio"));
    const input = mediaReferences(option("input_reference"));
    if (input.length && imageInput !== undefined) throw invalidRequest("Use input_reference or image reference aliases, not both.", "conflicting_parameters", "input_reference");
    const images = mediaReferences(imageInput, "image", "images");
    const videos = mediaReferences(videoInput, "video", "videos");
    const audios = mediaReferences(audioInput, "audio", "audios");
    // Upstream images/image_urls strings mean first/last frames; explicit reference_* stays reference mode.
    if (option("reference_images") === undefined && !videos.length && !audios.length && images.length <= 2) {
        images.forEach((ref, i) => { ref.role ??= i === 0 ? "first_frame" : "last_frame"; });
    }
    const referenceMedia = [...input, ...images, ...videos, ...audios];
    if (content?.references.length) {
        if (referenceMedia.length) throw invalidRequest("Use content references or reference fields, not both.", "conflicting_parameters", "content");
        referenceMedia.push(...content.references);
    }
    const frames = referenceMedia.filter((ref) => ref.role === "first_frame" || ref.role === "last_frame");
    if (frames.length) {
        if (frames.length !== referenceMedia.length || frames.filter((ref) => ref.role === "first_frame").length !== 1 || frames.filter((ref) => ref.role === "last_frame").length > 1) {
            throw invalidRequest("Frame mode requires one first_frame and at most one last_frame; do not mix it with reference mode.", "invalid_reference", "images");
        }
    }
    return { prompt, seconds, resolution: normalizeVideoPricingResolution(resolution), size: ratio ?? (tierInSize ? undefined : rawSize), referenceMedia,
        generateAudio: option("generate_audio"), watermark: option("watermark"), seed: option("seed"), cameraFixed: option("camera_fixed"), webSearch: option("web_search") };
}
