import { Global, Module } from "@nestjs/common";
import { WalletModule } from "../wallet/wallet.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";

/**
 * Global because AuthGuard is registered application-wide and needs SessionService.
 */
@Global()
@Module({
    imports: [WalletModule],
    controllers: [AuthController],
    providers: [AuthService, SessionService],
    exports: [AuthService, SessionService],
})
export class AuthModule {}
