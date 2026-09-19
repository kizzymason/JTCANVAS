import { Module } from "@nestjs/common";
import { OpenApiModule } from "../openapi/openapi.module";
import { WalletModule } from "../wallet/wallet.module";
import { ResellerController } from "./reseller.controller";
import { ResellerService } from "./reseller.service";

/** The reseller-facing console. Key management is reused from the open-platform module. */
@Module({
    imports: [OpenApiModule, WalletModule],
    controllers: [ResellerController],
    providers: [ResellerService],
    exports: [ResellerService],
})
export class ResellerModule {}
