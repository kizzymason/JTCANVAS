import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators";
import { CardDistService } from "./card-dist.service";
import { CardChannelOrderQueryDto, CreateChannelCheckoutDto, PaginationQueryDto } from "./dto/card-dist.dto";
import { MerchantGuard, clientIp, userAgentOf, type RequestWithMerchant } from "./merchant.guard";

/**
 * Sales-channel API, authenticated with a channel secret.
 *
 * `@Public()` only tells the global session guard to stand aside; `MerchantGuard` then does the real
 * authentication. This is a server-to-server surface: the secret must never reach a browser, which
 * is also why there is no CORS handling here and why the docs say so in bold.
 *
 * There is deliberately no endpoint that reports a payment, adjusts an amount or releases a code
 * early. A channel can open a checkout and read the result — the money and the delivery are ours.
 */
@ApiTags("card-dist")
@ApiSecurity("bearer")
@Public()
@UseGuards(MerchantGuard)
@Controller("card-dist/v1")
export class CardDistController {
    constructor(private readonly dist: CardDistService) {}

    @Get("products")
    @Throttle({ default: { limit: 120, ttl: 60_000 } })
    @ApiOperation({ summary: "可售商品、对外售价、库存与可用支付方式" })
    products(@Req() request: RequestWithMerchant) {
        return this.dist.products(request.merchant!);
    }

    @Post("checkouts")
    @Throttle({ default: { limit: 120, ttl: 60_000 } })
    @ApiOperation({ summary: "创建收银台：主站定价、主站收款，返回付款链接与二维码" })
    createCheckout(@Req() request: RequestWithMerchant, @Body() body: CreateChannelCheckoutDto) {
        return this.dist.createCheckout(request.merchant!, body, { clientIp: clientIp(request), userAgent: userAgentOf(request) });
    }

    @Get("checkouts/:orderNo")
    @Throttle({ default: { limit: 600, ttl: 60_000 } })
    @ApiOperation({ summary: "查询订单状态；已支付时返回卡密" })
    checkout(@Req() request: RequestWithMerchant, @Param("orderNo") orderNo: string) {
        return this.dist.checkout(request.merchant!, orderNo);
    }

    @Get("orders")
    @Throttle({ default: { limit: 60, ttl: 60_000 } })
    @ApiOperation({ summary: "本渠道的销售记录" })
    orders(@Req() request: RequestWithMerchant, @Query() query: CardChannelOrderQueryDto) {
        return this.dist.orders(request.merchant!, query);
    }

    @Get("stats")
    @Throttle({ default: { limit: 60, ttl: 60_000 } })
    @ApiOperation({ summary: "销售额、佣金累计与应付、今日额度使用情况" })
    stats(@Req() request: RequestWithMerchant) {
        return this.dist.stats(request.merchant!);
    }

    @Get("payouts")
    @Throttle({ default: { limit: 60, ttl: 60_000 } })
    @ApiOperation({ summary: "已收到的分红记录" })
    payouts(@Req() request: RequestWithMerchant, @Query() query: PaginationQueryDto) {
        return this.dist.payouts(request.merchant!, query);
    }
}
