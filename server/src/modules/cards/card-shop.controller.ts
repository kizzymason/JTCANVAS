import { Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Public } from "../../common/decorators";
import { flattenQuery } from "../payments/epay.sign";
import { CardShopService } from "./card-shop.service";
import { CardCheckoutDto, CardOrderLookupDto } from "./dto/card-shop.dto";

/**
 * Public storefront. Everything here is deliberately unauthenticated: a purchase hands over redeem
 * codes and never touches an account, so requiring a login would only cost conversions. Because
 * there is no session to rate-limit against, the write paths carry their own throttles.
 */
@ApiTags("card-shop")
@Public()
@Controller("card-shop")
export class CardShopController {
    constructor(private readonly shop: CardShopService) {}

    @Get("catalog")
    @ApiOperation({ summary: "在售卡密商品、库存与可用支付方式" })
    catalog() {
        return this.shop.catalog();
    }

    @Post("orders")
    @Throttle({ default: { limit: 10, ttl: 60_000 } })
    @ApiOperation({ summary: "创建卡密订单并返回收银台地址（免登录）" })
    create(@Body() body: CardCheckoutDto, @Req() request: FastifyRequest) {
        return this.shop.createOrder({
            body,
            clientIp: request.ip ?? "",
            userAgent: String(request.headers["user-agent"] ?? ""),
        });
    }

    @Get("orders/:orderNo")
    @Throttle({ default: { limit: 60, ttl: 60_000 } })
    @ApiOperation({ summary: "按订单号查询；待支付时会向网关核对一次。带上下单返回的 token 才会返回卡密" })
    getOrder(@Param("orderNo") orderNo: string, @Query("token") token?: string) {
        return this.shop.getOrder(orderNo, token);
    }

    @Post("orders/lookup")
    @Throttle({ default: { limit: 20, ttl: 60_000 } })
    @ApiOperation({ summary: "用下单邮箱查询历史订单与已购卡密" })
    lookup(@Body() body: CardOrderLookupDto) {
        return this.shop.listOrdersByEmail(body);
    }

    @SkipThrottle()
    @Get("notify")
    @ApiOperation({ summary: "易支付异步通知（卡密订单）" })
    async notifyGet(@Query() query: Record<string, unknown>, @Res() reply: FastifyReply) {
        const body = await this.shop.handleNotify(flattenQuery(query));
        return reply.type("text/plain; charset=utf-8").send(body);
    }

    @SkipThrottle()
    @Post("notify")
    @ApiOperation({ summary: "易支付异步通知（部分通道会 POST）" })
    async notifyPost(@Query() query: Record<string, unknown>, @Body() body: Record<string, unknown>, @Res() reply: FastifyReply) {
        const text = await this.shop.handleNotify(flattenQuery({ ...query, ...(body ?? {}) }));
        return reply.type("text/plain; charset=utf-8").send(text);
    }

    @SkipThrottle()
    @Get("return")
    @ApiOperation({ summary: "易支付同步跳转，回到订单查询页" })
    async returnGet(@Query() query: Record<string, unknown>, @Res() reply: FastifyReply) {
        const dest = await this.shop.handleReturn(flattenQuery(query));
        return reply.redirect(dest);
    }
}
