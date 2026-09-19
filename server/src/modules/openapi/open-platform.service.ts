import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { AppError } from "../../common/errors";
import { GenerationService, type TaskResponse } from "../generation/generation.service";
import { PricingService } from "../pricing/pricing.service";
import type { CreateGenerationDto } from "../generation/dto/generation.dto";
import type { Capability, PublicModel } from "../pricing/pricing.types";
import { decodeModelValue } from "../pricing/pricing.types";
import { ApiKeyService } from "./api-key.service";
import type { ApiCaller } from "./api-key.guard";
import { dedupeModels, publicModelId } from "./openai-mappers";
import { invalidRequest, modelNotFound, permissionDenied } from "./openai-errors";
import { RateLimitService } from "./rate-limit.service";
import { UsageRecorderService, type UsageRecord } from "./usage-recorder.service";

export type BilledCall = {
    endpoint: string;
    capability?: Capability;
    model?: string;
    clientIp: string;
};

/**
 * Shared orchestration for the `/v1` endpoints: limit the call, run it, and make sure exactly one
 * usage row is written whichever way it ends. Each controller keeps only its protocol translation.
 */
@Injectable()
export class OpenPlatformService {
    private readonly logger = new Logger(OpenPlatformService.name);

    constructor(
        private readonly generation: GenerationService,
        private readonly pricing: PricingService,
        private readonly keys: ApiKeyService,
        private readonly limits: RateLimitService,
        private readonly usage: UsageRecorderService,
    ) {}

    /** Models this key may call, already deduplicated to one entry per public id. */
    async listModels(caller: ApiCaller, capability?: Capability) {
        const all = capability ? await this.pricing.listByCapability(capability) : await this.pricing.listPublicModels();
        const scoped = all.filter((model) => this.inScope(caller, model));
        return dedupeModels(scoped);
    }

    /**
     * Resolves a downstream model id. A bare name picks the highest-priority channel serving it, which
     * is the same channel the worker will execute on, so the quoted price and the charge agree.
     */
    async resolveModel(caller: ApiCaller, modelId: string, capability: Capability) {
        const requested = (modelId ?? "").trim();
        if (!requested) throw modelNotFound("");

        const { channelId, modelName } = decodeModelValue(requested);
        const candidates = await this.pricing.listByCapability(capability);
        const matched = channelId ? candidates.find((item) => item.channelId === channelId && item.modelName === modelName) : candidates.find((item) => item.modelName === modelName);
        if (!matched) throw modelNotFound(requested);
        if (!this.inScope(caller, matched)) {
            throw permissionDenied(`This API key is not allowed to use the model \`${requested}\`.`, "model_not_in_scope");
        }
        return matched;
    }

    /**
     * Runs a call under the key's RPM and concurrency budgets, writing a usage row either way. The
     * in-flight slot is released in a finally block so a thrown error cannot leak concurrency.
     */
    async runBilled<T>(caller: ApiCaller, call: BilledCall, handler: () => Promise<{ result: T; usage: Partial<UsageRecord> }>): Promise<T> {
        const startedAt = Date.now();
        const rpm = await this.limits.consumeRequest(caller.apiKey.id, caller.apiKey.rpmLimit);
        await this.limits.acquireSlot(caller.apiKey.id, caller.apiKey.concurrencyLimit);

        try {
            const { result, usage } = await handler();
            await this.record(caller, call, { ...usage, status: usage.status ?? "success", httpStatus: 200, latencyMs: Date.now() - startedAt });
            void this.keys.touch(caller.apiKey.id).catch(() => undefined);
            return result;
        } catch (error) {
            await this.record(caller, call, {
                status: "failed",
                httpStatus: statusOf(error),
                errorCode: codeOf(error),
                latencyMs: Date.now() - startedAt,
            });
            throw error;
        } finally {
            await this.limits.releaseSlot(caller.apiKey.id).catch((error) => this.logger.warn(`Failed to release a concurrency slot: ${String(error)}`));
            void rpm;
        }
    }

    submitTask(caller: ApiCaller, input: CreateGenerationDto, call?: BilledCall & { deferredUsage?: boolean }): Promise<TaskResponse> {
        return this.generation.submit(caller.userId, input, {
            multiplier: caller.multiplier,
            maxActive: this.limits.concurrencyLimitFor(caller.apiKey.concurrencyLimit),
            apiContext: {
                apiKeyId: caller.apiKey.id,
                endpoint: call?.endpoint,
                model: call?.model,
                clientIp: call?.clientIp,
                deferredUsage: call?.deferredUsage,
            },
        });
    }

    async getTask(caller: ApiCaller, taskId: string) {
        try {
            return await this.generation.get(caller.userId, taskId);
        } catch (error) {
            // Ownership is enforced by the query, so "not found" also covers another tenant's job.
            if (error instanceof AppError && error.getStatus() === HttpStatus.NOT_FOUND) {
                throw invalidRequest(`No job found with id \`${taskId}\`.`, "job_not_found", "id");
            }
            throw error;
        }
    }

    private inScope(caller: ApiCaller, model: PublicModel) {
        const scope = caller.apiKey.modelScope;
        if (!scope.length) return true;
        return scope.includes(publicModelId(model)) || scope.includes(model.value);
    }

    private record(caller: ApiCaller, call: BilledCall, extra: Partial<UsageRecord>) {
        return this.usage.record({
            userId: caller.userId,
            apiKeyId: caller.apiKey.id,
            endpoint: call.endpoint,
            capability: call.capability ?? "",
            model: call.model ?? "",
            clientIp: call.clientIp,
            multiplier: caller.multiplier,
            status: "success",
            httpStatus: 200,
            latencyMs: 0,
            ...extra,
        } as UsageRecord);
    }
}

function statusOf(error: unknown) {
    if (error && typeof error === "object" && "getStatus" in error && typeof (error as { getStatus: unknown }).getStatus === "function") {
        return (error as { getStatus: () => number }).getStatus();
    }
    return 500;
}

function codeOf(error: unknown) {
    if (error instanceof AppError) {
        const body = error.getResponse();
        if (body && typeof body === "object" && "code" in body && typeof (body as { code: unknown }).code === "string") return (body as { code: string }).code;
    }
    if (error && typeof error === "object" && "getResponse" in error && typeof (error as { getResponse: unknown }).getResponse === "function") {
        const body = (error as { getResponse: () => unknown }).getResponse();
        if (body && typeof body === "object" && "error" in body) {
            const inner = (body as { error?: { code?: unknown; type?: unknown } }).error;
            if (inner && typeof inner.code === "string") return inner.code;
            if (inner && typeof inner.type === "string") return inner.type;
        }
    }
    return error instanceof Error ? error.name : "unknown_error";
}
