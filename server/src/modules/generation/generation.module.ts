import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { WalletModule } from "../wallet/wallet.module";
import { GenerationController } from "./generation.controller";
import { GENERATION_QUEUE } from "./generation.queue";
import { GenerationService } from "./generation.service";
import { PiapiPoolService } from "./piapi-pool.service";
import { ScriptRunnerService } from "./script-runner.service";
import { GeminiAdapter } from "./provider/gemini.adapter";
import { OpenAiAdapter } from "./provider/openai.adapter";
import { PiapiAdapter } from "./provider/piapi.adapter";
import { ProviderRegistry } from "./provider/provider.registry";

/**
 * Shared by the API and the worker. The processor itself is registered only in the worker module,
 * so the API process never executes a provider call or decrypts a credential.
 */
@Module({
    imports: [BullModule.registerQueue({ name: GENERATION_QUEUE }), WalletModule],
    controllers: [GenerationController],
    providers: [GenerationService, PiapiPoolService, ScriptRunnerService, ProviderRegistry, OpenAiAdapter, GeminiAdapter, PiapiAdapter],
    exports: [GenerationService, PiapiPoolService, ProviderRegistry, ScriptRunnerService],
})
export class GenerationModule {}
