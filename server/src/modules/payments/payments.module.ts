import { Module } from "@nestjs/common";
import { WalletModule } from "../wallet/wallet.module";
import { EpayAdapter } from "./epay.adapter";
import { YqpayAdapter } from "./yqpay.adapter";
import { PaymentGatewayRegistry } from "./payment-gateway.registry";
import { PaymentsCallbackController, WalletRechargeController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
    imports: [WalletModule],
    controllers: [WalletRechargeController, PaymentsCallbackController],
    providers: [PaymentsService, EpayAdapter, YqpayAdapter, PaymentGatewayRegistry],
    exports: [PaymentsService],
})
export class PaymentsModule {}
