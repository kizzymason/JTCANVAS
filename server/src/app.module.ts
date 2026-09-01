import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import { configuration } from "./config/configuration";
import { validateEnv } from "./config/env.validation";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { AuthGuard } from "./common/guards/auth.guard";
import { AuditInterceptor } from "./common/interceptors/audit.interceptor";
import { IdempotencyInterceptor } from "./common/interceptors/idempotency.interceptor";
import { DbModule } from "./db/db.module";
import { RedisModule } from "./redis/redis.module";
import { AdminModule } from "./modules/admin/admin.module";
import { AssetsModule } from "./modules/assets/assets.module";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CryptoModule } from "./modules/crypto/crypto.module";
import { GenerationModule } from "./modules/generation/generation.module";
import { HealthController } from "./modules/health/health.controller";
import { PricingModule } from "./modules/pricing/pricing.module";
import { ProjectsModule } from "./modules/projects/projects.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { StorageModule } from "./modules/storage/storage.module";
import { VisitorsModule } from "./modules/visitors/visitors.module";
import { WalletModule } from "./modules/wallet/wallet.module";

/** Shared by the API process and the worker; the worker adds the queue processor on top. */
@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnv, cache: true }),
        LoggerModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                pinoHttp: {
                    level: config.get<string>("logLevel"),
                    genReqId: (request) => String(request.headers["x-request-id"] ?? randomUUID()),
                    // Never let a credential or a cookie reach the logs.
                    redact: ["req.headers.cookie", "req.headers.authorization", "req.body.password", "req.body.currentPassword", "req.body.newPassword", "req.body.apiKey", "req.body.secretAccessKey"],
                    transport: config.get<string>("env") === "development" ? { target: "pino-pretty", options: { singleLine: true, translateTime: "SYS:HH:MM:ss" } } : undefined,
                },
            }),
        }),
        ThrottlerModule.forRoot({ throttlers: [{ limit: 120, ttl: 60_000 }] }),
        ScheduleModule.forRoot(),
        BullModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                connection: { url: config.get<string>("redis.url") },
                defaultJobOptions: {
                    attempts: config.get<number>("generation.attempts"),
                    backoff: { type: "exponential", delay: 5000 },
                },
            }),
        }),
        DbModule,
        RedisModule,
        CryptoModule,
        SettingsModule,
        AuditModule,
        WalletModule,
        AuthModule,
        StorageModule,
        PricingModule,
        GenerationModule,
        ProjectsModule,
        AssetsModule,
        VisitorsModule,
        AdminModule,
    ],
    controllers: [HealthController],
    providers: [
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        // Order matters: authenticate, then rate-limit the identified caller.
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    ],
})
export class AppModule {}
