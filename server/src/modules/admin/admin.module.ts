import { Module } from "@nestjs/common";
import { GenerationModule } from "../generation/generation.module";
import { VisitorsModule } from "../visitors/visitors.module";
import { WalletModule } from "../wallet/wallet.module";
import { PaymentsModule } from "../payments/payments.module";
import { OpenApiModule } from "../openapi/openapi.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { OpenApiService } from "./openapi.service";
import { ResellerAdminController } from "./reseller.admin.controller";
import { ResellerAdminService } from "./reseller.admin.service";

@Module({
    imports: [WalletModule, GenerationModule, VisitorsModule, PaymentsModule, OpenApiModule],
    controllers: [AdminController, ResellerAdminController],
    providers: [AdminService, OpenApiService, ResellerAdminService],
    exports: [OpenApiService],
})
export class AdminModule {}
