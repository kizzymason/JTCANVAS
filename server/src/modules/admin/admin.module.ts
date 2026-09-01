import { Module } from "@nestjs/common";
import { GenerationModule } from "../generation/generation.module";
import { WalletModule } from "../wallet/wallet.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { OpenApiService } from "./openapi.service";

@Module({
    imports: [WalletModule, GenerationModule],
    controllers: [AdminController],
    providers: [AdminService, OpenApiService],
    exports: [OpenApiService],
})
export class AdminModule {}
