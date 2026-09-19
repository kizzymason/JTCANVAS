import { Global, Module } from "@nestjs/common";
import { PricingController } from "./pricing.controller";
import { PricingService } from "./pricing.service";
import { ResellerPricingService } from "./reseller-pricing.service";

@Global()
@Module({
    controllers: [PricingController],
    providers: [PricingService, ResellerPricingService],
    exports: [PricingService, ResellerPricingService],
})
export class PricingModule {}
