import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import Redis from "ioredis";
import { DB, type Database } from "../../db/db.module";
import { channelModels, channels, generationTasks } from "../../db/schema";
import { ceilMoney, mulMoney, toMoneyString } from "../../common/money";
import { REDIS } from "../../redis/redis.module";
import { CryptoService } from "../crypto/crypto.service";
import { StorageService } from "../storage/storage.service";
import { WalletService } from "../wallet/wallet.service";
import { GENERATION_QUEUE, statusChannel, streamChannel, type GenerationJobData } from "./generation.queue";
import { ScriptRunnerService } from "./script-runner.service";
import { ProviderRegistry } from "./provider/provider.registry";
import type { GenerationRequest, ReferenceInput } from "./provider/provider.types";

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
            const output = await this.execute(task);
            const fileIds = await this.persistOutputs(userId, output.binaries, task.capability);
            const succeeded = task.capability === "text" ? (output.text ? 1 : 0) : fileIds.length;
            const actual = await this.actualCost(task, succeeded, output.actualQuantity);

            await this.db
                .update(generationTasks)
                .set({
                    status: succeeded >= task.quantity ? "succeeded" : succeeded > 0 ? "partial" : "failed",
                    succeededCount: succeeded,
                    actualCost: actual,
                    outputFileIds: fileIds,
                    outputText: output.text ?? "",
                    providerTaskId: output.providerTaskId ?? "",
                    finishedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(generationTasks.id, taskId));

            if (!succeeded) {
                await this.wallet.release({ userId, taskId, amount: task.estimatedCost, note: "生成失败退回" });
            } else {
                await this.wallet.settle({ userId, taskId, frozenAmount: task.estimatedCost, actualAmount: actual });
            }
            await this.publishStatus(taskId, succeeded ? "succeeded" : "failed");
            this.logger.log(`Task ${taskId} finished: ${succeeded}/${task.quantity} outputs, charged ${actual}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.db
                .update(generationTasks)
                .set({ status: "failed", error: message.slice(0, 2000), finishedAt: new Date(), updatedAt: new Date() })
                .where(eq(generationTasks.id, taskId));
            // Failures are never charged.
            await this.wallet.release({ userId, taskId, amount: task.estimatedCost, note: "生成失败退回" }).catch((releaseError) => {
                this.logger.error(`Failed to release funds for task ${taskId}: ${String(releaseError)}`);
            });
            await this.publishStatus(taskId, "failed", message);
            throw error;
        }
    }

    private async execute(task: typeof generationTasks.$inferSelect) {
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
            references: await this.loadReferences(task.userId, (params.references as string[]) ?? []),
            mask: params.mask ? (await this.loadReferences(task.userId, [params.mask as string]))[0] : undefined,
            count: Number(params.count ?? 1),
            size: String(params.size ?? ""),
            quality: String(params.quality ?? ""),
            background: String(params.background ?? ""),
            seconds: Number(params.seconds ?? 0) || undefined,
            resolution: String(params.resolution ?? ""),
            generateAudio: Boolean(params.generateAudio),
            watermark: Boolean(params.watermark),
            voice: String(params.voice ?? ""),
            audioFormat: String(params.audioFormat ?? ""),
            audioSpeed: String(params.audioSpeed ?? ""),
            audioInstructions: String(params.audioInstructions ?? ""),
            reasoningEffort: String(params.reasoningEffort ?? "auto"),
        };

        const onDelta = task.capability === "text" ? (chunk: string) => void this.redis.publish(streamChannel(task.id), chunk) : undefined;

        // An admin script overrides the built-in dialect entirely.
        if (row.model.script.trim()) {
            const result = await this.scripts.run(row.model.script, credentials, request);
            return { binaries: result.binaries, text: result.text, actualQuantity: result.binaries.length };
        }

        const adapter = this.providers.resolve(row.channel.apiFormat);
        return adapter.generate(credentials, request, onDelta);
    }

    private async loadReferences(userId: string, storageKeys: string[]): Promise<ReferenceInput[]> {
        const references: ReferenceInput[] = [];
        for (const storageKey of storageKeys) {
            const file = await this.storage.findByStorageKey(userId, storageKey);
            if (!file) continue;
            references.push({ storageKey, mimeType: file.mimeType, fileName: fileNameFor(storageKey, file.mimeType), body: await this.storage.read(file) });
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

    /**
     * Charge for what was actually produced. Per-second models bill on the reported duration when the
     * provider gives one; otherwise the estimate stands.
     */
    private async actualCost(task: typeof generationTasks.$inferSelect, succeeded: number, actualQuantity?: number) {
        if (!succeeded) return toMoneyString(0);
        const quantity = actualQuantity ?? succeeded;
        if (quantity >= task.quantity) return task.estimatedCost;
        // Pro-rate: unit price is estimate / requested quantity.
        const perUnit = mulMoney(task.estimatedCost, 1 / Math.max(1, task.quantity));
        return toMoneyString(ceilMoney(mulMoney(perUnit, quantity)));
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
