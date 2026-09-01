import { Injectable } from "@nestjs/common";
import axios from "axios";
import { AppError, badRequest } from "../../../common/errors";
import type { Capability } from "../../pricing/pricing.types";
import { isPublicHttpUrl } from "../../storage/public-file-url";
import { PiapiPoolService } from "../piapi-pool.service";
import { delay, fetchBinary, throwIfAborted } from "./openai.adapter";
import {
    assertPiapiReferences,
    ephemeralFileData,
    ephemeralFileName,
    ephemeralUploadUrl,
    PIAPI_EPHEMERAL_UPLOAD_URL,
    PIAPI_MAX_REFERENCE_IMAGES,
    piapiSeedreamInput,
} from "./piapi-references";
import { ProviderAdapter, type GeneratedBinary, type GenerationOutput, type GenerationRequest, type ProviderCredentials, type ReferenceInput } from "./provider.types";

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 300_000;
const OUTPUT_FORMAT = "png";
const PIAPI_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9"];
const LITE_SIZES = ["2K", "3K"];
const PRO_SIZES = ["1K", "2K"];
const SIZE_ORDER = ["1K", "2K", "3K"];

type PiapiEnvelope<T> = { code?: number; data?: T; message?: string };
type PiapiTask = { task_id?: string; status?: string; output?: { image_url?: string; image_urls?: string[] } | null; error?: { message?: string } | null };

/**
 * PiAPI Seedream. Channel credentials are ignored; each call draws a key from the account pool.
 *
 * Seedream only accepts public http(s) `image_urls`. Frontend uploads land in private storage, so
 * the worker re-hosts those bytes on PiAPI's ephemeral CDN and forwards the returned URLs.
 */
@Injectable()
export class PiapiAdapter extends ProviderAdapter {
    readonly format = "piapi" as const;

    constructor(private readonly pool: PiapiPoolService) {
        super();
    }

    supports(capability: Capability) {
        return capability === "image";
    }

    async generate(_credentials: ProviderCredentials, request: GenerationRequest): Promise<GenerationOutput> {
        if (!this.supports(request.capability)) throw badRequest("PIAPI_UNSUPPORTED", "PiAPI 渠道当前只支持图片生成");
        assertPiapiReferences(request.references, request.mask);

        const size = outputSize(request.model, request.quality);
        const aspectRatio = closestRatio(request.size);
        const prompt = request.systemPrompt?.trim() ? `${request.systemPrompt.trim()}\n\n${request.prompt}` : request.prompt;
        const imageUrls = await this.resolveImageUrls(request.references, request.signal);
        const input = piapiSeedreamInput({ prompt, aspectRatio, size, outputFormat: OUTPUT_FORMAT, imageUrls });

        // Each requested image is an independent PiAPI task, each drawing its own key from the pool.
        const results = await Promise.all(
            Array.from({ length: request.count }, () =>
                this.pool.runWithKey(async (apiKey) => {
                    const created = await axios.post<PiapiEnvelope<PiapiTask>>(
                        "https://api.piapi.ai/api/v1/task",
                        { model: "seedream", task_type: request.model, input },
                        { headers: { "x-api-key": apiKey, "Content-Type": "application/json" }, signal: request.signal },
                    );
                    const task = readEnvelope(created.data, "PiAPI 任务创建失败");
                    if (!task.task_id) throw badRequest("PIAPI_CREATE_FAILED", task.error?.message || "PiAPI 任务创建失败");
                    return this.poll(apiKey, task.task_id, request.signal);
                }),
            ),
        );

        const binaries: GeneratedBinary[] = [];
        for (const urls of results) for (const url of urls) binaries.push(await fetchBinary(url, request.signal));
        return { binaries, actualQuantity: binaries.length };
    }

    /**
     * Already-public URLs (not our /api/files token links) go straight into `image_urls`.
     * Stored files are re-hosted on PiAPI's ephemeral CDN; a Creator-plan 403 falls back to APP_PUBLIC_URL.
     */
    private async resolveImageUrls(references: ReferenceInput[], signal?: AbortSignal) {
        if (!references.length) return [];
        const slots: Array<{ type: "ready"; url: string } | { type: "host"; reference: ReferenceInput }> = references.map((reference) => {
            if (reference.publicUrl && isPublicHttpUrl(reference.publicUrl) && !reference.publicUrl.includes("/api/files/")) {
                return { type: "ready", url: reference.publicUrl };
            }
            return { type: "host", reference };
        });
        const toHost = slots.filter((slot): slot is { type: "host"; reference: ReferenceInput } => slot.type === "host").map((slot) => slot.reference);
        try {
            const hosted = toHost.length ? await this.hostReferences(toHost, signal) : [];
            let index = 0;
            return slots.map((slot) => (slot.type === "ready" ? slot.url : hosted[index++]));
        } catch (error) {
            if (!isPiapiUploadPlanError(error)) throw error;
            const fallback = references.map((reference) => reference.publicUrl).filter((url): url is string => Boolean(url && isPublicHttpUrl(url)));
            if (fallback.length === references.length) return fallback;
            throw error;
        }
    }
    private async hostReferences(references: ReferenceInput[], signal?: AbortSignal) {
        return this.pool.runWithKey((apiKey) => Promise.all(references.map((reference) => this.uploadReference(apiKey, reference, signal))));
    }

    private async uploadReference(apiKey: string, reference: ReferenceInput, signal?: AbortSignal) {
        try {
            const response = await axios.post<PiapiEnvelope<{ url?: string }>>(
                PIAPI_EPHEMERAL_UPLOAD_URL,
                { file_name: ephemeralFileName(reference.fileName, reference.mimeType), file_data: ephemeralFileData(reference.body, reference.mimeType) },
                { headers: { "x-api-key": apiKey, "Content-Type": "application/json" }, signal },
            );
            return ephemeralUploadUrl(response.data);
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const data = error.response?.data as { message?: string } | undefined;
                if (status === 403) throw badRequest("PIAPI_UPLOAD_PLAN", "PiAPI 临时图床需要 Creator 套餐以上，无法上传参考图");
                throw badRequest("PIAPI_UPLOAD_FAILED", data?.message || "参考图上传到 PiAPI 临时图床失败");
            }
            throw error;
        }
    }

    /** Documented as synchronous but actually returns `pending`, so the task has to be polled. */
    private async poll(apiKey: string, taskId: string, signal?: AbortSignal) {
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        for (;;) {
            throwIfAborted(signal);
            await delay(POLL_INTERVAL_MS, signal);
            const response = await axios.get<PiapiEnvelope<PiapiTask>>(`https://api.piapi.ai/api/v1/task/${encodeURIComponent(taskId)}`, {
                headers: { "x-api-key": apiKey },
                signal,
            });
            const task = readEnvelope(response.data, "PiAPI 任务查询失败");
            const status = (task.status || "").toLowerCase();
            if (status === "completed") {
                const urls = (task.output?.image_urls ?? []).filter(Boolean);
                const all = urls.length ? urls : task.output?.image_url ? [task.output.image_url] : [];
                if (!all.length) throw badRequest("PIAPI_NO_IMAGE", "PiAPI 任务完成但没有返回图片");
                return all;
            }
            if (status === "failed") throw badRequest("PIAPI_TASK_FAILED", task.error?.message || "PiAPI 任务执行失败");
            if (Date.now() >= deadline) throw badRequest("PIAPI_TIMEOUT", "PiAPI 任务超时（5 分钟），请稍后重试");
        }
    }
}

/** PiAPI answers 200 with a non-200 `code` on business errors, so the envelope needs checking. */
function readEnvelope<T>(payload: PiapiEnvelope<T> | undefined, fallback: string): T {
    if (!payload || payload.data === undefined || payload.data === null) throw badRequest("PIAPI_ERROR", payload?.message || fallback);
    if (payload.code !== undefined && payload.code !== 200) throw badRequest("PIAPI_ERROR", payload.message || fallback);
    return payload.data;
}

function isProTaskType(taskType: string) {
    return taskType.includes("pro");
}

function outputSize(taskType: string, quality: string | undefined) {
    const supported = isProTaskType(taskType) ? PRO_SIZES : LITE_SIZES;
    const value = (quality ?? "").trim().toLowerCase();
    const requested = value === "low" || value === "standard" || value === "1k" ? "1K" : value === "medium" || value === "hd" || value === "2k" ? "2K" : value === "high" || value === "4k" ? "3K" : "";
    if (!requested) return supported[0];
    if (supported.includes(requested)) return requested;
    // Clamp into range rather than failing: 1K on lite becomes 2K, 3K on pro becomes 2K.
    return SIZE_ORDER.indexOf(requested) < SIZE_ORDER.indexOf(supported[0]) ? supported[0] : supported[supported.length - 1];
}

function parseRatio(value: string) {
    const [width, height] = value.split(":");
    const ratio = { width: Number(width), height: Number(height) };
    return ratio.width > 0 && ratio.height > 0 ? ratio : { width: 1, height: 1 };
}

function closestRatio(size: string | undefined) {
    const value = (size ?? "").trim();
    if (!value || value.toLowerCase() === "auto") return "1:1";
    const pixels = value.match(/^(\d+)\s*[x×*]\s*(\d+)$/i);
    const target = pixels ? Number(pixels[1]) / Number(pixels[2]) : parseRatio(value).width / parseRatio(value).height;
    if (!Number.isFinite(target) || target <= 0) return "1:1";
    return PIAPI_ASPECT_RATIOS.reduce((best, item) => {
        const current = parseRatio(item);
        const bestRatio = parseRatio(best);
        return Math.abs(current.width / current.height - target) < Math.abs(bestRatio.width / bestRatio.height - target) ? item : best;
    });
}

export { PIAPI_MAX_REFERENCE_IMAGES as MAX_REFERENCE_IMAGES };

function isPiapiUploadPlanError(error: unknown) {
    if (!(error instanceof AppError)) return false;
    const body = error.getResponse();
    return typeof body === "object" && body !== null && "code" in body && (body as { code: string }).code === "PIAPI_UPLOAD_PLAN";
}
