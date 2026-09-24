import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import Redis from "ioredis";
import { DB, type Database } from "../../db/db.module";
import { channelModels, channels, generationTasks } from "../../db/schema";
import { REDIS } from "../../redis/redis.module";
import { CryptoService } from "../crypto/crypto.service";
import { isPublicHttpUrl } from "../storage/public-file-url";
import { StorageService } from "../storage/storage.service";
import { WalletService } from "../wallet/wallet.service";
import { AppError } from "../../common/errors";
import { parseModelFeatures } from "../pricing/model-features";
import { tokenTimeMultiplier, type TokenPrices } from "../pricing/token-pricing";
import { countTextTokens } from "../pricing/token-counter";
import { ApiKeyService } from "../openapi/api-key.service";
import { UsageRecorderService } from "../openapi/usage-recorder.service";
import { GENERATION_QUEUE, statusChannel, streamChannel, type GenerationJobData } from "./generation.queue";
import { settleGenerationTask, videoBillableQuantity, videoSecondsFromParams, type GenerationSettlement } from "./generation-settlement";
import { friendlySeedanceError } from "./provider/seedance-video";
import { ScriptRunnerService } from "./script-runner.service";
import { ProviderRegistry } from "./provider/provider.registry";
import type { GenerationRequest, ReferenceInput, GenerationOutput } from "./provider/provider.types";
import { isSeedanceModel, isSeedreamModel } from "./provider/openai.adapter";
import { mimeFromReferenceUrl } from "./reference-media";
import { providerFailureDetails } from "./provider/provider-error";

/**
 * Runs in the worker process only. This is the sole place where a provider credential is decrypted
 * and an upstream request is made, and the sole place a task is settled.
 */
// Concurrency is read from the env here because decorators evaluate before DI is available.
@Processor(GENERATION_QUEUE, { concurrency: Number(process.env.GENERATION_WORKER_CONCURRENCY) || 4 })
@Injectable()
export class GenerationProcessor extends WorkerHost {
    private readonly logger = new Logger(GenerationProcessor.name);

    constructor(
        @Inject(DB) private readonly db: Database,
        @Inject(REDIS) private readonly redis: Redis,
        private readonly providers: ProviderRegistry,
        private readonly scripts: ScriptRunnerService,
        private readonly storage: StorageService,
        private readonly wallet: WalletService,
        private readonly crypto: CryptoService,
        private readonly config: ConfigService,
        private readonly apiKeys: ApiKeyService,
        private readonly apiUsage: UsageRecorderService,
    ) {
        super();
    }

    async process(job: Job<GenerationJobData>) {
        const { taskId, userId } = job.data;
        const [task] = await this.db.select().from(generationTasks).where(eq(generationTasks.id, taskId)).limit(1);
        if (!task) {
            this.logger.warn(`Task ${taskId} vanished before execution`);
            return;
        }
        // A retry of an already-settled task must not charge twice.
        if (task.status !== "pending" && task.status !== "running") return;

        await this.db.update(generationTasks).set({ status: "running", startedAt: new Date(), updatedAt: new Date() }).where(eq(generationTasks.id, taskId));

        try {
            const executionPrices = tokenPricesFrom(task.params.tokenPrices);
            const timeMultiplier = executionPrices ? tokenTimeMultiplier(executionPrices) : "1";
            const output = await this.execute(task);
            const fileIds = await this.persistOutputs(userId, output.binaries, task.capability);
            const outputCount = task.capability === "text" ? (output.text ? 1 : 0) : fileIds.length;
            const params = task.params as Record<string, unknown>;
            const actualQuantity =
                task.capability === "video" && outputCount
                    ? videoBillableQuantity(output.actualQuantity, params, task.quantity, outputCount)
                    : output.actualQuantity;
            const billingMode = typeof params.billingMode === "string" ? params.billingMode : undefined;
            // Recorded for every text task, not just token-billed ones: the open platform reports usage
            // on `per_call` models too, and settlement simply ignores it there.
            const settledUsage = task.capability === "text" ? (output.usage ?? localTextUsage(task, params, output.text)) : undefined;
            const settled = settleGenerationTask({
                capability: task.capability,
                quantity: task.quantity,
                estimatedCost: task.estimatedCost,
                outputCount,
                actualQuantity,
                usageTokens: output.usageTokens,
                estimatedTokens: asTokenCount(params.estimatedTokens),
                upstreamUsdPerM: typeof params.upstreamUsdPerM === "string" ? params.upstreamUsdPerM : undefined,
                billingMultiplier: typeof params.billingMultiplier === "string" ? params.billingMultiplier : undefined,
                billingMode,
                tokenTimeMultiplier: timeMultiplier,
                videoTokenPrice: typeof params.videoTokenPrice === "string" ? params.videoTokenPrice : undefined,
                tokenPrices: tokenPricesFrom(params.tokenPrices),
                // An upstream that hides usage still has to be billed, so the reply is measured locally.
                usage: settledUsage,
            });

            await this.db
                .update(generationTasks)
                .set({
                    status: settled.status,
                    succeededCount: settled.succeededCount,
                    actualCost: settled.actualCost,
                    outputFileIds: fileIds,
                    outputText: output.text ?? "",
                    providerTaskId: output.providerTaskId ?? "",
                    // Settled token counts belong on the task: the open platform reports them as `usage`.
                    ...((settledUsage || output.usageTokens !== undefined) ? { params: { ...params,
                        ...(settledUsage ? { actualInputTokens: settledUsage.inputTokens, actualOutputTokens: settledUsage.outputTokens, actualCacheReadTokens: settledUsage.cacheReadTokens ?? 0, actualCacheWriteTokens: settledUsage.cacheWriteTokens ?? 0, tokenTimeMultiplier: timeMultiplier } : {}),
                        ...(output.usageTokens !== undefined ? { actualUsageTokens: output.usageTokens } : {}) } } : {}),
                    finishedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(generationTasks.id, taskId));

            if (settled.status === "failed") {
                await this.wallet.release({ userId, taskId, amount: task.estimatedCost, note: "生成失败退回" });
            } else {
                await this.wallet.settle({ userId, taskId, frozenAmount: task.estimatedCost, actualAmount: settled.actualCost });
            }
            await this.recordOpenApiSettlement(task, params, settled, settledUsage);
            await this.publishStatus(taskId, settled.status === "failed" ? "failed" : "succeeded");
            this.logger.log(`Task ${taskId} finished: ${settled.succeededCount}/${task.quantity} billed, charged ${settled.actualCost}`);
        } catch (error) {
            const message = friendlySeedanceError(taskErrorMessage(error));
            const failure = providerFailureDetails(error);
            await this.db
                .update(generationTasks)
                .set({ status: "failed", error: message.slice(0, 2000), ...(failure ? { params: { ...task.params, providerFailure: failure } } : {}), finishedAt: new Date(), updatedAt: new Date() })
                .where(eq(generationTasks.id, taskId));
            // Failures are never charged.
            await this.wallet.release({ userId, taskId, amount: task.estimatedCost, note: "生成失败退回" }).catch((releaseError) => {
                this.logger.error(`Failed to release funds for task ${taskId}: ${String(releaseError)}`);
            });
            await this.recordOpenApiSettlement(task, task.params as Record<string, unknown>, { status: "failed", succeededCount: 0, actualCost: "0.000000" }, undefined, message);
            await this.publishStatus(taskId, "failed", message);
            throw error;
        }
    }

    /**
     * Key quota follows worker settlement rather than status polling. This is essential for async
     * video: a client may never poll, or may poll a completed task many times.
     */
    private async recordOpenApiSettlement(
        task: typeof generationTasks.$inferSelect,
        params: Record<string, unknown>,
        settled: GenerationSettlement,
        usage?: { inputTokens: number; outputTokens: number },
        error = "",
    ) {
        if (task.source !== "openapi") return;
        const apiKeyId = typeof params.apiKeyId === "string" ? params.apiKeyId : "";
        if (!apiKeyId) return;

        await this.apiKeys.settleUsageReservation(apiKeyId, task.estimatedCost, settled.actualCost).catch((quotaError) => {
            this.logger.error(`Failed to settle API-key quota for task ${task.id}: ${String(quotaError)}`);
        });

        if (params.apiUsageDeferred !== true) return;
        await this.apiUsage.finalizeDeferred({
            userId: task.userId,
            apiKeyId,
            taskId: task.id,
            channelId: task.channelId,
            endpoint: typeof params.apiEndpoint === "string" && params.apiEndpoint ? params.apiEndpoint : "/v1/videos",
            capability: task.capability,
            model: typeof params.apiModel === "string" && params.apiModel ? params.apiModel : task.modelName,
            status: settled.status === "failed" ? "failed" : "success",
            httpStatus: settled.status === "failed" ? 502 : 200,
            errorCode: settled.status === "failed" ? "generation_failed" : "",
            quantity: settled.succeededCount,
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            billedAmount: settled.actualCost,
            multiplier: typeof params.billingMultiplier === "string" ? params.billingMultiplier : "1",
            latencyMs: Math.max(0, Date.now() - task.createdAt.getTime()),
            clientIp: typeof params.apiClientIp === "string" ? params.apiClientIp : "",
            deferred: false,
            ...(error ? { errorCode: "generation_failed" } : {}),
        });
    }

    private async execute(task: typeof generationTasks.$inferSelect): Promise<GenerationOutput> {
        const [row] = await this.db
            .select({ channel: channels, model: channelModels })
            .from(channelModels)
            .innerJoin(channels, eq(channelModels.channelId, channels.id))
            .where(eq(channelModels.id, task.channelModelId!))
            .limit(1);
        if (!row) throw new Error("渠道或模型已被删除，无法执行");

        const params = task.params as Record<string, unknown>;
        const credentials = {
            baseUrl: row.channel.baseUrl,
            apiKey: this.crypto.decrypt(row.channel.apiKeyCipher, row.channel.apiKeyId),
        };

        const request: GenerationRequest = {
            capability: task.capability,
            model: task.modelName,
            prompt: task.prompt,
            references: await this.loadReferences(task.userId, (params.references as string[]) ?? [],
                params.referenceMedia as Array<{ mimeType: string; role?: ReferenceInput["role"] }> | undefined,
                !row.model.script.trim() && row.channel.apiFormat === "openai" && (isSeedanceModel(task.modelName) || isSeedreamModel(task.modelName))),
            mask: params.mask ? (await this.loadReferences(task.userId, [params.mask as string]))[0] : undefined,
            count: Number(params.count ?? 1),
            size: String(params.size ?? ""),
            quality: String(params.quality ?? ""),
            background: String(params.background ?? ""),
            seconds: Number(params.seconds ?? 0) || undefined,
            resolution: String(params.resolution ?? ""),
            generateAudio: Boolean(params.generateAudio),
            watermark: Boolean(params.watermark),
            seed: typeof params.seed === "number" ? params.seed : undefined,
            cameraFixed: typeof params.cameraFixed === "boolean" ? params.cameraFixed : undefined,
            webSearch: typeof params.webSearch === "boolean" ? params.webSearch : undefined,
            voice: String(params.voice ?? ""),
            audioFormat: String(params.audioFormat ?? ""),
            audioSpeed: String(params.audioSpeed ?? ""),
            audioInstructions: String(params.audioInstructions ?? ""),
            reasoningEffort: String(params.reasoningEffort ?? "auto"),
            maxOutputTokens: asTokenCount(params.maxOutputTokens),
            aspectPresets: parseModelFeatures(row.model.features).aspectPresets,
        };

        const onDelta = task.capability === "text" ? (chunk: string) => void this.redis.publish(streamChannel(task.id), chunk) : undefined;

        // An admin script overrides the built-in dialect entirely.
        if (row.model.script.trim()) {
            const result = await this.scripts.run(row.model.script, credentials, request);
            const actualQuantity =
                task.capability === "video"
                    ? result.binaries.length
                        ? videoSecondsFromParams(params, task.quantity, result.binaries.length)
                        : 0
                    : result.binaries.length;
            return { binaries: result.binaries, text: result.text, actualQuantity };
        }

        const adapter = this.providers.resolve(row.channel.apiFormat);
        return adapter.generate(credentials, request, onDelta);
    }

    private async loadReferences(userId: string, storageKeys: string[], media?: Array<{ mimeType: string; role?: ReferenceInput["role"] }>, passthrough = false): Promise<ReferenceInput[]> {
        const references: ReferenceInput[] = [];
        for (const [index, storageKey] of storageKeys.entries()) {
            const role = media?.[index]?.role;
            if (isPublicHttpUrl(storageKey)) {
                const mimeType = media?.[index]?.mimeType ?? mimeFromReferenceUrl(storageKey);
                const body = passthrough ? Buffer.alloc(0) : await downloadPublicImage(storageKey);
                references.push({
                    storageKey,
                    mimeType,
                    role,
                    fileName: fileNameFor(storageKey, mimeType),
                    body,
                    publicUrl: storageKey,
                });
                continue;
            }
            const file = await this.storage.findByStorageKey(userId, storageKey);
            if (!file) throw new Error("参考素材不存在或不属于当前账号");
            references.push({
                storageKey,
                mimeType: file.mimeType,
                role,
                fileName: fileNameFor(storageKey, file.mimeType),
                body: await this.storage.read(file),
                publicUrl: this.storage.signedPublicUrl(storageKey),
            });
        }
        return references;
    }

    private async persistOutputs(userId: string, binaries: Array<{ body: Buffer; mimeType: string }>, capability: string) {
        const prefix = capability === "image" ? "image" : capability === "video" ? "video" : capability === "audio" ? "audio" : "file";
        const files = await Promise.all(binaries.map((binary) => this.storage.save({ ownerId: userId, body: binary.body, mimeType: binary.mimeType, prefix })));
        // Generated results are referenced by the task itself, so they start with a reference held.
        await this.storage.retain(files.map((file) => file.storageKey), userId);
        return files.map((file) => file.id);
    }

    private publishStatus(taskId: string, status: string, error?: string) {
        return this.redis.publish(statusChannel(taskId), JSON.stringify({ status, error: error ?? "" }));
    }
}

function fileNameFor(storageKey: string, mimeType: string) {
    const safe = storageKey.replace(/[^a-zA-Z0-9]/g, "_");
    const value = mimeType.toLowerCase();
    const ext = value.startsWith("video/") ? "mp4" : value.startsWith("audio/") ? "mp3" : value.includes("jpeg") ? "jpg" : value.includes("webp") ? "webp" : "png";
    return `${safe}.${ext}`;
}

function taskErrorMessage(error: unknown) {
    if (error instanceof AppError) {
        const body = error.getResponse();
        if (body && typeof body === "object" && "message" in body && typeof (body as { message: unknown }).message === "string") {
            return (body as { message: string }).message;
        }
    }
    return error instanceof Error ? error.message : String(error);
}

function asTokenCount(value: unknown) {
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(n) || n < 1) return undefined;
    return Math.floor(n);
}

function tokenPricesFrom(value: unknown) {
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    const input = typeof record.input === "string" ? record.input : "";
    const output = typeof record.output === "string" ? record.output : "";
    if (!input && !output) return undefined;
    return { ...record, input: input || "0", output: output || "0" } as TokenPrices;
}

/**
 * Fallback usage for providers that stream text without a usage event. Input reuses the count taken
 * at submit time (the same number the freeze used) so billing stays self-consistent; output is
 * measured from the text we actually received.
 */
function localTextUsage(task: typeof generationTasks.$inferSelect, params: Record<string, unknown>, text: string | undefined): import("../pricing/token-pricing").TokenUsage {
    return {
        inputTokens: asTokenCount(params.inputTokens) ?? countTextTokens(task.prompt, task.modelName),
        outputTokens: countTextTokens(text ?? "", task.modelName),
    };
}

async function downloadPublicImage(url: string) {
    const response = await fetch(url, {
        redirect: "follow",
        headers: {
            accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "user-agent": "Mozilla/5.0 (compatible; JTCANVAS/1.0; generation-worker)",
        },
    });
    if (!response.ok) throw new Error(`参考图地址无法访问（HTTP ${response.status}）`);
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > 10 * 1024 * 1024) throw new Error("单张参考图不能超过 10MB");
    if (!body.byteLength) throw new Error("参考图地址没有返回图片");
    return body;
}
