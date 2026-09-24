import { InjectQueue } from "@nestjs/bullmq";
import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { DB, type Database, type DbTransaction } from "../../db/db.module";
import { apiKeys, files, generationTasks } from "../../db/schema";
import { AppError, badRequest, notFound, tooManyActiveTasks } from "../../common/errors";
import type { Paginated } from "../../common/types";
import { assertImageGenerationFeatures, assertVideoGenerationFeatures } from "../pricing/model-features";
import { PricingService } from "../pricing/pricing.service";
import { decodeModelValue } from "../pricing/pricing.types";
import { billableInputTokens } from "../pricing/token-counter";
import { SettingsService } from "../settings/settings.service";
import { assertGenerationEnabled } from "../settings/site-services";
import { StorageService } from "../storage/storage.service";
import { isPublicHttpUrl } from "../storage/public-file-url";
import { WalletService } from "../wallet/wallet.service";
import { GENERATION_QUEUE, type GenerationJobData } from "./generation.queue";
import { parseImageDimensions, pricingSpec } from "./image-size";
import { tierFromPixelSize, type AspectPreset } from "../pricing/aspect-presets";
import { billedVideoResolution, isVideoMime, videoPricingSpec } from "./video-pricing-spec";
import { whatsTokenImagePixelSpec, seedanceSpecResolution, seedanceTokensFor } from "./whatstoken-catalog";
import type { CreateGenerationDto } from "./dto/generation.dto";
import { assertReferenceKind, decodeReferenceImage, mediaMime, mimeFromReferenceUrl } from "./reference-media";

const ACTIVE_STATUSES = ["pending", "running"] as const;

/** Ceiling for token-billed output when the caller does not ask for one. */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

export type GenerationTask = typeof generationTasks.$inferSelect;

export type SubmitOptions = {
    /**
     * Reseller coefficient resolved by the caller. Passed in rather than looked up here so the canvas
     * path stays on public prices and only the open platform pays the reseller rate.
     */
    multiplier?: string;
    /** Overrides the per-user active-task cap; API keys carry their own concurrency budget. */
    maxActive?: number;
    /** Downstream attribution snapshotted for quota settlement and asynchronous video logging. */
    apiContext?: {
        apiKeyId: string;
        endpoint?: string;
        model?: string;
        clientIp?: string;
        deferredUsage?: boolean;
    };
};

export type TaskOutput = {
    id: string;
    storageKey: string;
    mimeType: string;
    bytes: number;
    width: number | null;
    height: number | null;
    durationMs: number | null;
};

export type TaskResponse = ReturnType<GenerationService["toResponse"]> & { outputs: TaskOutput[] };

/**
 * The API-side half of generation: validate, price, freeze funds, persist the task, enqueue.
 * It never calls a provider — that happens in the worker, which is the only place credentials
 * are decrypted.
 */
@Injectable()
export class GenerationService {
    private readonly logger = new Logger(GenerationService.name);
    private readonly maxActive: number;

    constructor(
        @Inject(DB) private readonly db: Database,
        @InjectQueue(GENERATION_QUEUE) private readonly queue: Queue<GenerationJobData>,
        private readonly pricing: PricingService,
        private readonly wallet: WalletService,
        private readonly storage: StorageService,
        private readonly settings: SettingsService,
        config: ConfigService,
    ) {
        this.maxActive = config.get<number>("generation.maxActiveTasksPerUser")!;
    }

    async submit(userId: string, input: CreateGenerationDto, opts?: SubmitOptions) {
        const site = await this.settings.getSite();
        assertGenerationEnabled(site, input.capability);
        const maxActive = opts?.maxActive && opts.maxActive > 0 ? opts.maxActive : this.maxActive;
        await this.assertCapacity(userId, undefined, maxActive);
        const resolvedReferences = await this.resolveReferences(userId, input);
        const references = resolvedReferences.references;

        const publicModel = await this.pricing.resolvePublicModel(input.model);
        if (publicModel.capability !== input.capability) throw badRequest("CAPABILITY_MISMATCH", "所选模型与请求的生成类型不一致");
        if (input.capability === "image") {
            assertImageGenerationFeatures(publicModel.features, {
                count: input.count,
                quality: input.quality,
                size: input.size,
                background: input.background,
            });
        } else if (input.capability === "video") {
            assertVideoGenerationFeatures(publicModel.features, { seconds: input.seconds, resolution: input.resolution, size: input.size });
        }

        const billedResolution = input.capability === "video" ? billedVideoResolution(input.resolution, publicModel.modelName) : undefined;
        const spec =
            input.capability === "image"
                ? whatsTokenImagePixelSpec(publicModel.modelName, input.size) ?? imageBillingSpec(input.quality, input.size, publicModel.features.aspectPresets)
                : input.capability === "video"
                  ? videoPricingSpec(input.resolution, references.some((item) => isVideoMime(item.mimeType)), publicModel.modelName)
                  : undefined;
        // Token counts are always derived server-side; a client-supplied count would be a billing hole.
        const maxOutputTokens = publicModel.billingMode === "per_token" ? (input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS) : undefined;
        const inputTokens = publicModel.billingMode === "per_token" ? billableInputTokens(input.prompt, publicModel.modelName) : undefined;
        const estimate = await this.pricing.estimate(
            {
                model: input.model,
                count: input.count ?? 1,
                seconds: input.seconds,
                spec,
                referenceCount: references.length,
                inputTokens,
                maxOutputTokens,
            },
            { multiplier: opts?.multiplier },
        );

        const { modelName } = decodeModelValue(input.model);
        const resolved = await this.pricing.resolveForExecution(input.model);
        const videoCount = Math.max(1, input.count ?? 1);
        const videoSeconds = input.seconds ?? 0;
        const estimatedTokens =
            estimate.videoTokenPrice && videoSeconds >= 1
                ? seedanceTokensFor(seedanceSpecResolution(spec ?? billedResolution), videoSeconds).times(videoCount).toFixed(0)
                : "";

        // One transaction: the task row and the frozen funds must appear together or not at all.
        const task = await this.db.transaction(async (tx) => {
            // Take the per-user wallet lock first so concurrent submits from one account serialise;
            // without it, four parallel requests all read the active-task count before any inserted.
            await this.wallet.lockForUpdate(tx, userId);
            await this.assertCapacity(userId, tx, maxActive);

            const [created] = await tx
                .insert(generationTasks)
                .values({
                    userId,
                    capability: input.capability,
                    channelId: resolved.channel.id,
                    channelModelId: resolved.model.id,
                    modelName,
                    prompt: input.prompt,
                    quantity: estimate.quantity,
                    estimatedCost: estimate.amount,
                    source: input.source ?? "",
                    params: {
                        count: input.count ?? 1,
                        size: input.size ?? "",
                        quality: input.quality ?? "",
                        background: input.background ?? "",
                        seconds: input.seconds ?? 0,
                        resolution: billedResolution ?? input.resolution ?? "",
                        generateAudio: input.capability === "video" ? (input.generateAudio ?? true) : (input.generateAudio ?? false),
                        watermark: input.watermark ?? false,
                        seed: input.seed,
                        cameraFixed: input.cameraFixed,
                        webSearch: input.webSearch,
                        voice: input.voice ?? "",
                        audioFormat: input.audioFormat ?? "",
                        audioSpeed: input.audioSpeed ?? "",
                        audioInstructions: input.audioInstructions ?? "",
                        reasoningEffort: input.reasoningEffort ?? "auto",
                        references: references.map((item) => item.storageKey),
                        referenceMedia: references.map((item) => ({ mimeType: item.mimeType, role: item.role })),
                        mask: resolvedReferences.mask ?? "",
                        spec: spec ?? "",
                        estimatedTokens,
                        upstreamUsdPerM: "",
                        videoTokenPrice: estimate.videoTokenPrice,
                        // Snapshotted so a tier change mid-flight cannot corrupt the settlement.
                        billingMultiplier: estimate.multiplier,
                        billingMode: publicModel.billingMode,
                        tokenPrices: estimate.tokenPrices,
                        inputTokens: inputTokens ?? 0,
                        maxOutputTokens: maxOutputTokens ?? 0,
                        apiKeyId: opts?.apiContext?.apiKeyId ?? "",
                        apiEndpoint: opts?.apiContext?.endpoint ?? "",
                        apiModel: opts?.apiContext?.model ?? "",
                        apiClientIp: opts?.apiContext?.clientIp ?? "",
                        apiUsageDeferred: opts?.apiContext?.deferredUsage ?? false,
                    },
                })
                .returning();

            await this.wallet.freeze(tx, { userId, amount: estimate.amount, taskId: created.id });
            if (opts?.apiContext?.apiKeyId) {
                const [reserved] = await tx
                    .update(apiKeys)
                    .set({
                        quotaUsed: sql`${apiKeys.quotaUsed} + ${estimate.amount}::numeric`,
                        updatedAt: new Date(),
                    })
                    .where(
                        and(
                            eq(apiKeys.id, opts.apiContext.apiKeyId),
                            eq(apiKeys.userId, userId),
                            eq(apiKeys.status, "active"),
                            or(isNull(apiKeys.quotaLimit), sql`${apiKeys.quotaUsed} + ${estimate.amount}::numeric <= ${apiKeys.quotaLimit}`),
                        ),
                    )
                    .returning({ id: apiKeys.id });
                if (!reserved) {
                    throw new AppError(HttpStatus.PAYMENT_REQUIRED, "api_key_quota_exhausted", "API key quota is insufficient for this request");
                }
            }
            return created;
        });

        await this.queue.add("run", { taskId: task.id, userId }, { jobId: task.id, removeOnComplete: true, removeOnFail: 500 });
        this.logger.log(`Task ${task.id} queued for ${userId}, frozen ${estimate.amount}`);
        return { ...this.toResponse(task), outputs: [] } satisfies TaskResponse;
    }

    async get(userId: string, taskId: string) {
        const [task] = await this.db
            .select()
            .from(generationTasks)
            .where(and(eq(generationTasks.id, taskId), eq(generationTasks.userId, userId)))
            .limit(1);
        if (!task) throw notFound("生成任务不存在");
        const [response] = await this.withOutputs([task]);
        return response;
    }

    async list(userId: string, query: { page: number; pageSize: number; capability?: GenerationTask["capability"]; status?: "active" }) {
        const where = and(
            eq(generationTasks.userId, userId),
            query.capability ? eq(generationTasks.capability, query.capability) : undefined,
            query.status === "active" ? inArray(generationTasks.status, ["pending", "running"]) : undefined,
        );
        const [items, [counted]] = await Promise.all([
            this.db
                .select()
                .from(generationTasks)
                .where(where)
                .orderBy(desc(generationTasks.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(generationTasks).where(where),
        ]);
        return { items: await this.withOutputs(items), total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize } satisfies Paginated<TaskResponse>;
    }

    /**
     * Attaches resolved output files. Done as one batched query for the whole page rather than a
     * lookup per task, so the history list stays a fixed number of round-trips.
     */
    private async withOutputs(tasks: GenerationTask[]): Promise<TaskResponse[]> {
        const ids = [...new Set(tasks.flatMap((task) => task.outputFileIds))];
        const rows = ids.length ? await this.db.select().from(files).where(inArray(files.id, ids)) : [];
        const byId = new Map(rows.map((row) => [row.id, row]));

        return tasks.map((task) => ({
            ...this.toResponse(task),
            outputs: task.outputFileIds
                .map((id) => byId.get(id))
                .filter((file): file is typeof files.$inferSelect => Boolean(file))
                .map((file) => ({
                    id: file.id,
                    storageKey: file.storageKey,
                    mimeType: file.mimeType,
                    bytes: file.bytes,
                    width: file.width,
                    height: file.height,
                    durationMs: file.durationMs,
                })),
        }));
    }

    /** Cancellation only stops the queue job; a task already running upstream is left to settle. */
    async cancel(userId: string, taskId: string) {
        const [task] = await this.db
            .select()
            .from(generationTasks)
            .where(and(eq(generationTasks.id, taskId), eq(generationTasks.userId, userId)))
            .limit(1);
        if (!task) throw notFound("生成任务不存在");
        if (!ACTIVE_STATUSES.includes(task.status as (typeof ACTIVE_STATUSES)[number])) return this.toResponse(task);

        const job = await this.queue.getJob(taskId);
        if (job && (await job.isWaiting())) {
            await job.remove();
            await this.db.update(generationTasks).set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() }).where(eq(generationTasks.id, taskId));
            await this.wallet.release({ userId, taskId, amount: task.estimatedCost, note: "用户取消生成" });
        }
        return this.get(userId, taskId);
    }

    async remove(userId: string, taskId: string) {
        const [task] = await this.db
            .select({ id: generationTasks.id, status: generationTasks.status })
            .from(generationTasks)
            .where(and(eq(generationTasks.id, taskId), eq(generationTasks.userId, userId)))
            .limit(1);
        if (!task) throw notFound("生成任务不存在");
        if (ACTIVE_STATUSES.includes(task.status as (typeof ACTIVE_STATUSES)[number])) {
            throw badRequest("TASK_ACTIVE", "进行中的任务不能删除，请先等待完成或取消");
        }
        const [removed] = await this.db
            .delete(generationTasks)
            .where(and(eq(generationTasks.id, taskId), eq(generationTasks.userId, userId)))
            .returning({ id: generationTasks.id });
        if (!removed) throw notFound("生成任务不存在");
        return removed;
    }

    /**
     * Keeps one user from occupying every worker slot. Called twice: once before the expensive pricing
     * work for a fast rejection, and once inside the transaction under the wallet lock, which is the
     * authoritative check.
     */
    private async assertCapacity(userId: string, tx?: DbTransaction, limit = this.maxActive) {
        const [row] = await (tx ?? this.db)
            .select({ total: sql<number>`count(*)::int` })
            .from(generationTasks)
            .where(and(eq(generationTasks.userId, userId), inArray(generationTasks.status, [...ACTIVE_STATUSES])));
        if ((row?.total ?? 0) >= limit) throw tooManyActiveTasks(limit);
    }

    private async resolveReferences(userId: string, input: CreateGenerationDto) {
        const media = input.referenceMedia ?? [];
        const refs = [...(input.references ?? []), ...media.map((item) => item.url)];
        const keys = [...refs, ...(input.mask ? [input.mask] : [])];
        if (!keys.length) return { references: [], mask: undefined };
        const resolved = await Promise.all(
            keys.map(async (key, index) => {
                const typed = media[index - (input.references?.length ?? 0)];
                if (isPublicHttpUrl(key)) {
                    const mimeType = typed ? mediaMime[typed.type] : mimeFromReferenceUrl(key);
                    assertReferenceKind(mimeType, typed);
                    return { storageKey: key, mimeType };
                }
                const file = key.startsWith("data:")
                    ? await this.storage.save({ ownerId: userId, ...decodeReferenceImage(key), prefix: "image" })
                    : await this.storage.findByStorageKey(userId, key);
                if (file) assertReferenceKind(file.mimeType, typed);
                return file;
            }),
        );
        const missing = keys.filter((_key, index) => !resolved[index]);
        if (missing.length) throw badRequest("REFERENCE_NOT_FOUND", "参考素材不存在或不属于当前账号");
        return { references: refs.map((_key, index) => ({ storageKey: resolved[index]!.storageKey, mimeType: resolved[index]!.mimeType,
            role: media[index - (input.references?.length ?? 0)]?.role })), mask: input.mask ? resolved[refs.length]!.storageKey : undefined };
    }

    toResponse(task: GenerationTask) {
        return {
            id: task.id,
            capability: task.capability,
            modelName: task.modelName,
            model: task.channelId ? `${task.channelId}::${task.modelName}` : "",
            status: task.status,
            prompt: task.prompt,
            quantity: task.quantity,
            succeededCount: task.succeededCount,
            estimatedCost: task.estimatedCost,
            actualCost: task.actualCost,
            outputFileIds: task.outputFileIds,
            outputText: task.outputText,
            error: task.error,
            params: task.params,
            createdAt: task.createdAt,
            finishedAt: task.finishedAt,
        };
    }
}

/**
 * Billing tier for an image request.
 *
 * An explicit WxH is what the upstream renders, so it decides the tier; the quality selector is
 * only honest for a bare ratio. Without this, a 2K selection on `736x1312` was billed the 2K price
 * while the customer received a 0.97MP (1K band) image.
 */
export function imageBillingSpec(quality: string | undefined, size: string | undefined, presets: AspectPreset[]) {
    const dimensions = parseImageDimensions(size ?? "");
    if (dimensions) return tierFromPixelSize(dimensions.width, dimensions.height, presets);
    return pricingSpec(quality, size, presets);
}
