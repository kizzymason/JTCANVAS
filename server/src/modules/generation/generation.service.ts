import { InjectQueue } from "@nestjs/bullmq";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { DB, type Database, type DbTransaction } from "../../db/db.module";
import { files, generationTasks } from "../../db/schema";
import { badRequest, notFound, tooManyActiveTasks } from "../../common/errors";
import type { Paginated } from "../../common/types";
import { assertImageGenerationFeatures, assertVideoGenerationFeatures } from "../pricing/model-features";
import { PricingService } from "../pricing/pricing.service";
import { decodeModelValue } from "../pricing/pricing.types";
import { SettingsService } from "../settings/settings.service";
import { assertGenerationEnabled } from "../settings/site-services";
import { StorageService } from "../storage/storage.service";
import { WalletService } from "../wallet/wallet.service";
import { GENERATION_QUEUE, type GenerationJobData } from "./generation.queue";
import { pricingSpec } from "./image-size";
import { isVideoMime, videoPricingSpec } from "./video-pricing-spec";
import type { CreateGenerationDto } from "./dto/generation.dto";

const ACTIVE_STATUSES = ["pending", "running"] as const;

export type GenerationTask = typeof generationTasks.$inferSelect;

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

    async submit(userId: string, input: CreateGenerationDto) {
        const site = await this.settings.getSite();
        assertGenerationEnabled(site, input.capability);
        await this.assertCapacity(userId);
        const references = await this.resolveReferences(userId, input);

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
            assertVideoGenerationFeatures(publicModel.features, { seconds: input.seconds, resolution: input.resolution });
        }

        const spec =
            input.capability === "image"
                ? pricingSpec(input.quality, input.size)
                : input.capability === "video"
                  ? videoPricingSpec(input.resolution, references.some((item) => isVideoMime(item.mimeType)))
                  : undefined;
        const estimate = await this.pricing.estimate({
            model: input.model,
            count: input.count ?? 1,
            seconds: input.seconds,
            spec,
            referenceCount: references.length,
        });

        const { modelName } = decodeModelValue(input.model);
        const resolved = await this.pricing.resolveForExecution(input.model);

        // One transaction: the task row and the frozen funds must appear together or not at all.
        const task = await this.db.transaction(async (tx) => {
            // Take the per-user wallet lock first so concurrent submits from one account serialise;
            // without it, four parallel requests all read the active-task count before any inserted.
            await this.wallet.lockForUpdate(tx, userId);
            await this.assertCapacity(userId, tx);

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
                        resolution: input.resolution ?? "",
                        generateAudio: input.generateAudio ?? false,
                        watermark: input.watermark ?? false,
                        voice: input.voice ?? "",
                        audioFormat: input.audioFormat ?? "",
                        audioSpeed: input.audioSpeed ?? "",
                        audioInstructions: input.audioInstructions ?? "",
                        reasoningEffort: input.reasoningEffort ?? "auto",
                        references: references.map((item) => item.storageKey),
                        mask: input.mask ?? "",
                        spec: spec ?? "",
                    },
                })
                .returning();

            await this.wallet.freeze(tx, { userId, amount: estimate.amount, taskId: created.id });
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

    async list(userId: string, query: { page: number; pageSize: number; capability?: GenerationTask["capability"] }) {
        const where = query.capability ? and(eq(generationTasks.userId, userId), eq(generationTasks.capability, query.capability)) : eq(generationTasks.userId, userId);
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

    /**
     * Keeps one user from occupying every worker slot. Called twice: once before the expensive pricing
     * work for a fast rejection, and once inside the transaction under the wallet lock, which is the
     * authoritative check.
     */
    private async assertCapacity(userId: string, tx?: DbTransaction) {
        const [row] = await (tx ?? this.db)
            .select({ total: sql<number>`count(*)::int` })
            .from(generationTasks)
            .where(and(eq(generationTasks.userId, userId), inArray(generationTasks.status, [...ACTIVE_STATUSES])));
        if ((row?.total ?? 0) >= this.maxActive) throw tooManyActiveTasks(this.maxActive);
    }

    private async resolveReferences(userId: string, input: CreateGenerationDto) {
        const keys = [...(input.references ?? []), ...(input.mask ? [input.mask] : [])];
        if (!keys.length) return [];
        const resolved = await Promise.all(keys.map((key) => this.storage.findByStorageKey(userId, key)));
        const missing = keys.filter((_key, index) => !resolved[index]);
        if (missing.length) throw badRequest("REFERENCE_NOT_FOUND", `参考图不存在或不属于当前账号：${missing.join(", ")}`);
        return (input.references ?? []).map((key, index) => ({ storageKey: key, mimeType: resolved[index]?.mimeType ?? "" }));
    }

    toResponse(task: GenerationTask) {
        return {
            id: task.id,
            capability: task.capability,
            modelName: task.modelName,
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
