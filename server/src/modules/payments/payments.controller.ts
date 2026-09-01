import { Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CurrentUser, Idempotent, Public } from "../../common/decorators";
import type { AuthUser } from "../../common/types";
import { CreateRechargeDto } from "./dto/payments.dto";
import { flattenQuery } from "./epay.sign";
import { PaymentsService } from "./payments.service";

@ApiTags("wallet")
@Controller("wallet")
export class WalletRechargeController {
    constructor(private readonly payments: PaymentsService) {}

    @Get("recharge-catalog")
    @ApiOperation({ summary: "充值套餐、自定义限额与可用支付方式" })
    catalog() {
        return this.payments.catalog();
    }

    @Post("recharge")
    @Idempotent("wallet.recharge")
    @Throttle({ default: { limit: 10, ttl: 60_000 } })
    @ApiOperation({ summary: "创建在线充值订单并返回收银台地址" })
    create(@CurrentUser() user: AuthUser, @Body() body: CreateRechargeDto, @Req() request: FastifyRequest) {
        return this.payments.createRecharge({
            userId: user.id,
            body,
            clientIp: request.ip ?? "",
            userAgent: String(request.headers["user-agent"] ?? ""),
        });
    }

    @Get("orders/:orderNo")
    @ApiOperation({ summary: "查询充值订单；待支付时会向网关核对一次" })
    getOrder(@CurrentUser() user: AuthUser, @Param("orderNo") orderNo: string) {
        return this.payments.getUserOrder(user.id, orderNo);
    }
}

@ApiTags("payments")
@Controller("payments")
export class PaymentsCallbackController {
    constructor(private readonly payments: PaymentsService) {}

    @Public()
    @SkipThrottle()
    @Get("epay/notify")
    @ApiOperation({ summary: "易支付异步通知（Z-Pay / 彩虹协议）" })
    async notifyGet(@Query() query: Record<string, unknown>, @Res() reply: FastifyReply) {
        const body = await this.payments.handleNotify(flattenQuery(query));
        return reply.type("text/plain; charset=utf-8").send(body);
    }

    @Public()
    @SkipThrottle()
    @Post("epay/notify")
    @ApiOperation({ summary: "易支付异步通知（部分通道会 POST）" })
    async notifyPost(@Query() query: Record<string, unknown>, @Body() body: Record<string, unknown>, @Res() reply: FastifyReply) {
        const payload = flattenQuery({ ...query, ...(body ?? {}) });
        const text = await this.payments.handleNotify(payload);
        return reply.type("text/plain; charset=utf-8").send(text);
    }

    @Public()
    @SkipThrottle()
    @Get("epay/return")
    @ApiOperation({ summary: "易支付同步跳转" })
    async returnGet(@Query() query: Record<string, unknown>, @Res() reply: FastifyReply) {
        const dest = await this.payments.handleReturn(flattenQuery(query));
        return reply.redirect(dest);
    }
}
