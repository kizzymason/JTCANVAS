import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Idempotent } from "../../common/decorators";
import type { AuthUser } from "../../common/types";
import { LedgerQueryDto, PaginationDto, RedeemDto } from "./dto/wallet.dto";
import { RedeemService } from "./redeem.service";
import { WalletService } from "./wallet.service";

@ApiTags("wallet")
@Controller("wallet")
export class WalletController {
    constructor(
        private readonly wallet: WalletService,
        private readonly redeem: RedeemService,
    ) {}

    @Get()
    @ApiOperation({ summary: "当前用户余额" })
    get(@CurrentUser() user: AuthUser) {
        return this.wallet.get(user.id);
    }

    @Get("ledger")
    @ApiOperation({ summary: "余额流水" })
    ledger(@CurrentUser() user: AuthUser, @Query() query: LedgerQueryDto) {
        return this.wallet.listLedger(user.id, query);
    }

    @Get("orders")
    @ApiOperation({ summary: "充值订单" })
    orders(@CurrentUser() user: AuthUser, @Query() query: PaginationDto) {
        return this.wallet.listOrders(user.id, query);
    }

    @Post("redeem")
    // Idempotent because a double-tap on the redeem button must not consume two cards.
    @Idempotent("wallet.redeem")
    @ApiOperation({ summary: "卡密兑换余额" })
    redeemCard(@CurrentUser() user: AuthUser, @Body() body: RedeemDto) {
        return this.redeem.redeem({ userId: user.id, code: body.code });
    }
}
