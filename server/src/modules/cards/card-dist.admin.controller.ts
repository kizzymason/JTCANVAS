import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminOnly, Audit, CurrentUser } from "../../common/decorators";
import type { AuthUser } from "../../common/types";
import { CardDistAdminService } from "./card-dist.admin.service";
import {
    AdjustCardMerchantCommissionDto,
    CardMerchantPayoutDto,
    CardMerchantScopedQueryDto,
    PaginationQueryDto,
    ReplaceCardMerchantPricesDto,
    ReverseCardCommissionDto,
    UpsertCardMerchantDto,
} from "./dto/card-dist.dto";

/** Channel administration. Every mutation is audited: these calls decide who gets paid. */
@ApiTags("admin")
@AdminOnly()
@Controller("admin/card-dist")
export class CardDistAdminController {
    constructor(private readonly admin: CardDistAdminService) {}

    @Get("merchants")
    @ApiOperation({ summary: "销售渠道列表，含销量、佣金累计与应付" })
    list() {
        return this.admin.listMerchants();
    }

    @Post("merchants")
    @Audit({ action: "card_merchant.create", targetType: "card_merchant" })
    @ApiOperation({ summary: "新增销售渠道，密钥明文仅此一次返回" })
    create(@Body() body: UpsertCardMerchantDto) {
        return this.admin.createMerchant(body);
    }

    @Patch("merchants/:id")
    @Audit({ action: "card_merchant.update", targetType: "card_merchant" })
    @ApiOperation({ summary: "修改渠道佣金、额度上限、白名单或启停" })
    update(@Param("id") id: string, @Body() body: UpsertCardMerchantDto) {
        return this.admin.updateMerchant(id, body);
    }

    @Post("merchants/:id/reissue")
    @Audit({ action: "card_merchant.reissue", targetType: "card_merchant" })
    @ApiOperation({ summary: "重新签发渠道密钥，旧密钥立即失效" })
    reissue(@Param("id") id: string) {
        return this.admin.reissueSecret(id);
    }

    @Delete("merchants/:id")
    @Audit({ action: "card_merchant.delete", targetType: "card_merchant" })
    @ApiOperation({ summary: "删除渠道（已有成交订单或未结佣金时拒绝）" })
    remove(@Param("id") id: string) {
        return this.admin.removeMerchant(id);
    }

    @Post("merchants/:id/prices")
    @Audit({ action: "card_merchant.prices", targetType: "card_merchant" })
    @ApiOperation({ summary: "设置该渠道的对外售价（留空则用商品原价）" })
    prices(@Param("id") id: string, @Body() body: ReplaceCardMerchantPricesDto) {
        return this.admin.replacePrices(id, body);
    }

    @Get("merchants/:id/summary")
    @ApiOperation({ summary: "该渠道的销售额、佣金累计、冻结中与可结算金额" })
    summary(@Param("id") id: string) {
        return this.admin.summary(id);
    }

    @Post("merchants/:id/payouts")
    @Audit({ action: "card_merchant.payout", targetType: "card_merchant" })
    @ApiOperation({ summary: "登记一笔已打款的分红，扣减应付佣金" })
    payout(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: CardMerchantPayoutDto) {
        return this.admin.payout(id, body, user.id);
    }

    @Post("merchants/:id/adjust")
    @Audit({ action: "card_merchant.adjust", targetType: "card_merchant" })
    @ApiOperation({ summary: "手动调整应付佣金，正数增加负数减少" })
    adjust(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: AdjustCardMerchantCommissionDto) {
        return this.admin.adjustCommission(id, body, user.id);
    }

    @Get("merchants/:id/ledger")
    @ApiOperation({ summary: "渠道佣金流水（append-only）" })
    ledger(@Param("id") id: string, @Query() query: PaginationQueryDto) {
        return this.admin.ledger(id, query);
    }

    @Post("commission/reverse")
    @Audit({ action: "card_merchant.reverse", targetType: "card_order" })
    @ApiOperation({ summary: "订单退款后冲回该单佣金" })
    reverse(@CurrentUser() user: AuthUser, @Body() body: ReverseCardCommissionDto) {
        return this.admin.reverseCommission(body, user.id);
    }

    @Get("leaderboard")
    @ApiOperation({ summary: "渠道销量排行，用于决定分红" })
    leaderboard(@Query("days") days?: string) {
        return this.admin.leaderboard(days ? Number(days) : undefined);
    }

    @Get("orders")
    @ApiOperation({ summary: "渠道销售订单，可按渠道筛选" })
    orders(@Query() query: CardMerchantScopedQueryDto) {
        return this.admin.listOrders(query);
    }

    @Get("orders/:id/codes")
    @ApiOperation({ summary: "查看某单发出的卡密（用于客服核对）" })
    orderCodes(@Param("id") id: string) {
        return this.admin.orderCodes(id);
    }

    @Get("payouts")
    @ApiOperation({ summary: "分红记录" })
    payouts(@Query() query: CardMerchantScopedQueryDto) {
        return this.admin.payouts(query);
    }
}
