import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { LoggerModule } from "nestjs-pino";
import { configuration } from "./config/configuration";
import { validateEnv } from "./config/env.validation";
import { DbModule } from "./db/db.module";
import { RedisModule } from "./redis/redis.module";
import { AuditModule } from "./modules/audit/audit.module";
import { CryptoModule } from "./modules/crypto/crypto.module";
import { GENERATION_QUEUE } from "./modules/generation/generation.queue";
import { GenerationProcessor } from "./modules/generation/generation.processor";
import { PiapiPoolService } from "./modules/generation/piapi-pool.service";
import { ScriptRunnerService } from "./modules/generation/script-runner.service";
import { GeminiAdapter } from "./modules/generation/provider/gemini.adapter";
import { OpenAiAdapter } from "./modules/generation/provider/openai.adapter";
import { PiapiAdapter } from "./modules/generation/provider/piapi.adapter";
import { ProviderRegistry } from "./modules/generation/provider/provider.registry";
import { MaintenanceService } from "./modules/maintenance/maintenance.service";
import { PricingModule } from "./modules/pricing/pricing.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { StorageModule } from "./modules/storage/storage.module";
import { WalletModule } from "./modules/wallet/wallet.module";

/**
 * The worker process. It deliberately registers no controllers: it never accepts HTTP traffic, and it
 * is the only process that decrypts provider credentials or executes admin scripts.
 */
@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnv, cache: true }),
        LoggerModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                pinoHttp: {
                    level: config.get<string>("logLevel"),
                    transport: config.get<string>("env") === "development" ? { target: "pino-pretty", options: { singleLine: true, translateTime: "SYS:HH:MM:ss" } } : undefined,
                },
            }),
        }),
        ScheduleModule.forRoot(),
        BullModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                connection: { url: config.get<string>("redis.url") },
                defaultJobOptions: { attempts: config.get<number>("generation.attempts"), backoff: { type: "exponential", delay: 5000 } },
            }),
        }),
        // Worker concurrency is set on the @Processor decorator; this only wires the queue itself.
        BullModule.registerQueue({ name: GENERATION_QUEUE }),
        DbModule,
        RedisModule,
        CryptoModule,
        SettingsModule,
        AuditModule,
        WalletModule,
        StorageModule,
        PricingModule,
    ],
    providers: [GenerationProcessor, ProviderRegistry, OpenAiAdapter, GeminiAdapter, PiapiAdapter, PiapiPoolService, ScriptRunnerService, MaintenanceService],
})
export class WorkerModule {}
