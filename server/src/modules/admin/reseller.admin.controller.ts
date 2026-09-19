import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminOnly, Audit, CurrentUser } from "../../common/decorators";
import type { AuthUser } from "../../common/types";
import { ResellerListQueryDto, ReviewResellerDto, UpdateResellerDto, UpsertResellerTierDto } from "./dto/reseller-admin.dto";
import { ResellerAdminService } from "./reseller.admin.service";

/** Admin-only reseller administration. Every mutation is audited: these calls change what people pay. */
@ApiTags("admin")
@AdminOnly()
@Controller("admin/resellers")
export class ResellerAdminController {
    constructor(private readonly resellers: ResellerAdminService) {}

    @Get("tiers")
    @ApiOperation({ summary: "代理商等级与倍率列表" })
    listTiers() {
        return this.resellers.listTiers();
    }

    @Post("tiers")
    @Audit({ action: "reseller_tier.create", targetType: "reseller_tier" })
    @ApiOperation({ summary: "新增代理商等级" })
    async createTier(@Body() body: UpsertResellerTierDto) {
        const tier = await this.resellers.createTier(body);
        return { tier, audit: { targetId: tier.id, after: tier } };
    }

    @Patch("tiers/:id")
    @Audit({ action: "reseller_tier.update", targetType: "reseller_tier" })
    @ApiOperation({ summary: "修改代理商等级与倍率" })
    async updateTier(@Param("id") id: string, @Body() body: UpsertResellerTierDto) {
        const tier = await this.resellers.updateTier(id, body);
        return { tier, audit: { targetId: id, after: tier } };
    }

    @Delete("tiers/:id")
    @Audit({ action: "reseller_tier.delete", targetType: "reseller_tier" })
    @ApiOperation({ summary: "删除代理商等级" })
    async removeTier(@Param("id") id: string) {
        const result = await this.resellers.removeTier(id);
        return { ...result, audit: { targetId: id } };
    }

    @Get()
    @ApiOperation({ summary: "代理商与入驻申请列表" })
    list(@Query() query: ResellerListQueryDto) {
        return this.resellers.list(query);
    }

    @Get("counts")
    @ApiOperation({ summary: "各状态数量，用于审批角标" })
    counts() {
        return this.resellers.counts();
    }

    @Get(":userId")
    @ApiOperation({ summary: "代理商详情" })
    detail(@Param("userId") userId: string) {
        return this.resellers.detail(userId);
    }

    @Post(":userId/review")
    @Audit({ action: "reseller.review", targetType: "reseller" })
    @ApiOperation({ summary: "审批入驻申请，通过后角色改为代理商" })
    async review(@CurrentUser() user: AuthUser, @Param("userId") userId: string, @Body() body: ReviewResellerDto) {
        const result = await this.resellers.review(userId, user.id, body);
        return { ...result, audit: { targetId: userId, after: result } };
    }

    @Patch(":userId")
    @Audit({ action: "reseller.update", targetType: "reseller" })
    @ApiOperation({ summary: "调整等级、专属倍率或停用恢复" })
    async update(@Param("userId") userId: string, @Body() body: UpdateResellerDto) {
        const detail = await this.resellers.update(userId, body);
        return { reseller: detail, audit: { targetId: userId, after: detail } };
    }
}
