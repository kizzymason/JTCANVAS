import { Module } from "@nestjs/common";
import { GenerationModule } from "../generation/generation.module";
import { ApiKeyGuard } from "./api-key.guard";
import { ApiKeyService } from "./api-key.service";
import { OpenPlatformService } from "./open-platform.service";
import { RateLimitService } from "./rate-limit.service";
import { TaskWaiterService } from "./task-waiter.service";
import { UsageRecorderService } from "./usage-recorder.service";
import { V1ChatController } from "./v1-chat.controller";
import { V1ImagesController } from "./v1-images.controller";
import { V1ModelsController } from "./v1-models.controller";
import { V1VideosController } from "./v1-videos.controller";

/**
 * The downstream-facing half of the open platform. Exports its services so the reseller console and
 * the admin module can reuse key management and the usage rollups without duplicating queries.
 */
@Module({
    imports: [GenerationModule],
    controllers: [V1ModelsController, V1ImagesController, V1VideosController, V1ChatController],
    providers: [ApiKeyService, ApiKeyGuard, RateLimitService, UsageRecorderService, TaskWaiterService, OpenPlatformService],
    exports: [ApiKeyService, RateLimitService, UsageRecorderService],
})
export class OpenApiModule {}
