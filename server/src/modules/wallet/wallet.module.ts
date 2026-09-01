import { Module } from "@nestjs/common";
import { RedeemService } from "./redeem.service";
import { WalletController } from "./wallet.controller";
import { WalletService } from "./wallet.service";

@Module({
    controllers: [WalletController],
    providers: [WalletService, RedeemService],
    exports: [WalletService, RedeemService],
})
export class WalletModule {}
