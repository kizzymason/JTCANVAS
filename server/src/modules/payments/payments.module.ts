import { Module } from "@nestjs/common";
import { WalletModule } from "../wallet/wallet.module";
import { EpayAdapter } from "./epay.adapter";
import { PaymentGatewayRegistry } from "./payment-gateway.registry";
import { PaymentsCallbackController, WalletRechargeController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
    imports: [WalletModule],
    controllers: [WalletRechargeController, PaymentsCallbackController],
    providers: [PaymentsService, EpayAdapter, PaymentGatewayRegistry],
    exports: [PaymentsService],
})
export class PaymentsModule {}
