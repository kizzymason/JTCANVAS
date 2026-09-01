import { Injectable } from "@nestjs/common";
import axios from "axios";
import { badRequest } from "../../../common/errors";
import type { Capability } from "../../pricing/pricing.types";
import { PiapiPoolService } from "../piapi-pool.service";
import { delay, fetchBinary, throwIfAborted } from "./openai.adapter";
import { ProviderAdapter, type GeneratedBinary, type GenerationOutput, type GenerationRequest, type ProviderCredentials } from "./provider.types";

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 300_000;
const MAX_REFERENCE_IMAGES = 10;
const OUTPUT_FORMAT = "png";
const PIAPI_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9"];
const LITE_SIZES = ["2K", "3K"];
const PRO_SIZES = ["1K", "2K"];
const SIZE_ORDER = ["1K", "2K", "3K"];

type PiapiEnvelope<T> = { code?: number; data?: T; message?: string };
type PiapiTask = { task_id?: string; status?: string; output?: { image_url?: string; image_urls?: string[] } | null; error?: { message?: string } | null };

/**
 * PiAPI Seedream. Unlike the other adapters this one ignores the channel credential entirely and
 * draws a key from the account pool per task, which is what makes exhaustion invisible to the user.
 *
 * Reference images must be publicly reachable URLs: Seedream rejects data URIs, and PiAPI's own
 * upload host sends no CORS headers and is plan-gated, so a locally stored image cannot be used.
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
        if (request.mask) throw badRequest("PIAPI_MASK_UNSUPPORTED", "PiAPI 渠道暂不支持蒙版编辑");
        if (request.references.length) throw badRequest("PIAPI_REFERENCE_UNSUPPORTED", "PiAPI 图生图需要公网可访问的图片地址，当前参考图保存在服务端私有存储，暂不支持");

        const size = outputSize(request.model, request.quality);
        const aspectRatio = closestRatio(request.size);
        const prompt = request.systemPrompt?.trim() ? `${request.systemPrompt.trim()}\n\n${request.prompt}` : request.prompt;

        // Each requested image is an independent PiAPI task, each drawing its own key from the pool.
        const results = await Promise.all(
            Array.from({ length: request.count }, () =>
                this.pool.runWithKey(async (apiKey) => {
                    const created = await axios.post<PiapiEnvelope<PiapiTask>>(
                        "https://api.piapi.ai/api/v1/task",
                        { model: "seedream", task_type: request.model, input: { prompt, aspect_ratio: aspectRatio, output_format: OUTPUT_FORMAT, size } },
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

export { MAX_REFERENCE_IMAGES };
