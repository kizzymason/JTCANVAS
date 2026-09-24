import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators";
import type { AuthUser } from "../../common/types";
import { PaginationDto } from "../wallet/dto/wallet.dto";
import { ApiKeyService } from "../openapi/api-key.service";
import { ApplyResellerDto, CreateTokenDto, ResellerLogQueryDto, ResellerOverviewQueryDto, UpdateTokenDto } from "./dto/reseller.dto";
import { ResellerService } from "./reseller.service";

/**
 * The reseller's own console. Every route is session-authenticated like the rest of the app; the
 * console is a normal logged-in surface, and the API key is only for downstream machine traffic.
 *
 * Basic access is automatic at list price. Tier review does not interrupt access.
 */
@ApiTags("reseller")
@Controller("reseller")
export class ResellerController {
    constructor(
        private readonly reseller: ResellerService,
        private readonly keys: ApiKeyService,
    ) {}

    @Post("apply")
    @ApiOperation({ summary: "提交或重新提交代理商等级提升申请" })
    apply(@CurrentUser() user: AuthUser, @Body() body: ApplyResellerDto) {
        return this.reseller.apply(user.id, body);
    }

    @Get("status")
    @ApiOperation({ summary: "查询开放平台权限与等级申请状态" })
    status(@CurrentUser() user: AuthUser) {
        return this.reseller.status(user.id, user.role);
    }

    @Get("overview")
    @ApiOperation({ summary: "控制台仪表盘聚合数据" })
    async overview(@CurrentUser() user: AuthUser, @Query() query: ResellerOverviewQueryDto) {
        await this.reseller.assertAccess(user.id, user.role);
        return this.reseller.overview(user.id, query.days ?? 1);
    }

    @Get("realtime")
    @ApiOperation({ summary: "实时吞吐 QPS / RPM / TPM / Task" })
    async realtime(@CurrentUser() user: AuthUser) {
        await this.reseller.assertAccess(user.id, user.role);
        return this.reseller.realtime(user.id);
    }

    @Get("tokens")
    @ApiOperation({ summary: "令牌列表" })
    async tokens(@CurrentUser() user: AuthUser, @Query() query: PaginationDto) {
        await this.reseller.assertAccess(user.id, user.role);
        return this.keys.list(user.id, query);
    }

    @Get("tokens/options")
    @ApiOperation({ summary: "令牌下拉选项，用于日志筛选" })
    async tokenOptions(@CurrentUser() user: AuthUser) {
        await this.reseller.assertAccess(user.id, user.role);
        return { items: await this.keys.listAll(user.id) };
    }

    @Post("tokens")
    @ApiOperation({ summary: "创建令牌，明文密钥仅此一次返回" })
    async createToken(@CurrentUser() user: AuthUser, @Body() body: CreateTokenDto) {
        await this.reseller.assertAccess(user.id, user.role);
        return this.keys.create(user.id, body);
    }

    @Patch("tokens/:id")
    @ApiOperation({ summary: "修改令牌配置或启停" })
    async updateToken(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: UpdateTokenDto) {
        await this.reseller.assertAccess(user.id, user.role);
        // The explicit clear flags exist because `undefined` has to keep meaning "leave unchanged".
        return this.keys.update(user.id, id, {
            ...body,
            ...(body.clearQuotaLimit ? { quotaLimit: null } : {}),
            ...(body.clearExpiresAt ? { expiresAt: null } : {}),
        });
    }

    @Post("tokens/:id/reset-quota")
    @ApiOperation({ summary: "重置令牌已用额度" })
    async resetTokenQuota(@CurrentUser() user: AuthUser, @Param("id") id: string) {
        await this.reseller.assertAccess(user.id, user.role);
        return this.keys.resetQuota(user.id, id);
    }

    @Delete("tokens/:id")
    @ApiOperation({ summary: "删除令牌" })
    async removeToken(@CurrentUser() user: AuthUser, @Param("id") id: string) {
        await this.reseller.assertAccess(user.id, user.role);
        return this.keys.remove(user.id, id);
    }

    @Get("logs")
    @ApiOperation({ summary: "API 调用日志" })
    async logs(@CurrentUser() user: AuthUser, @Query() query: ResellerLogQueryDto) {
        await this.reseller.assertAccess(user.id, user.role);
        return this.reseller.logs(user.id, query);
    }

    @Get("models")
    @ApiOperation({ summary: "可用模型与含倍率后的价格" })
    async models(@CurrentUser() user: AuthUser) {
        await this.reseller.assertAccess(user.id, user.role);
        return this.reseller.models(user.id);
    }

    @Get("profile")
    @ApiOperation({ summary: "个人中心：等级、倍率、钱包与累计消费" })
    async profile(@CurrentUser() user: AuthUser) {
        await this.reseller.assertAccess(user.id, user.role);
        return this.reseller.profile(user.id, user.role);
    }

    @Patch("profile")
    @ApiOperation({ summary: "维护联系信息，不影响审批状态" })
    updateProfile(@CurrentUser() user: AuthUser, @Body() body: ApplyResellerDto) {
        return this.reseller.updateProfile(user.id, body, user.role);
    }
}
