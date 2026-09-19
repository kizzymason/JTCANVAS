import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module";
import { CardDistAdminController } from "./card-dist.admin.controller";
import { CardDistAdminService } from "./card-dist.admin.service";
import { CardDistController } from "./card-dist.controller";
import { CardDistService } from "./card-dist.service";
import { CardShopAdminController } from "./card-shop.admin.controller";
import { CardShopAdminService } from "./card-shop.admin.service";
import { CardShopController } from "./card-shop.controller";
import { CardShopService } from "./card-shop.service";
import { MerchantCommissionService } from "./merchant-commission.service";
import { MerchantGuard } from "./merchant.guard";
import { MerchantService } from "./merchant.service";
import { MerchantWebhookService } from "./merchant-webhook.service";

/**
 * Card sales, through two front doors onto one economy.
 *
 * Buyers either come to `/cards` themselves or arrive from a sales channel's own page. Either way we
 * set the price, our payment channel takes the money, and we deliver the codes — so there is one
 * order table, one funds pool and one uniqueness guarantee on the stock. A channel differs only in
 * earning a commission on what it sold, which an operator later pays out by hand.
 */
@Module({
    imports: [PaymentsModule],
    controllers: [CardShopController, CardShopAdminController, CardDistController, CardDistAdminController],
    providers: [
        CardShopService,
        CardShopAdminService,
        MerchantService,
        MerchantCommissionService,
        MerchantWebhookService,
        MerchantGuard,
        CardDistService,
        CardDistAdminService,
    ],
    exports: [CardShopService, MerchantCommissionService, MerchantWebhookService],
})
export class CardsModule {}
