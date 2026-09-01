import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { AdminOnly, Audit, CurrentUser } from "../../common/decorators";
import type { AuthUser } from "../../common/types";
import { AuditService } from "../audit/audit.service";
import { PiapiPoolService } from "../generation/piapi-pool.service";
import { SettingsService } from "../settings/settings.service";
import { RedeemService } from "../wallet/redeem.service";
import { PaginationDto } from "../wallet/dto/wallet.dto";
import { AdminService } from "./admin.service";
import { OpenApiService } from "./openapi.service";
import { AdjustBalanceDto, AdminLedgerQueryDto, AdminTaskQueryDto, CardBatchQueryDto, CardItemsQueryDto, ChannelModelDto, CreateCardBatchDto, ImportPiapiDto, ServiceSettingsDto, SiteSettingsDto, StorageSettingsDto, UpdateUserDto, UpsertChannelDto, UpsertPriceDto, UserQueryDto } from "./dto/admin.dto";
import { DeleteManyDto } from "../projects/dto/projects.dto";

/** Every route here is admin-only; the class-level guard means a new endpoint cannot leak by omission. */
@ApiTags("admin")
@AdminOnly()
@Controller("admin")
export class AdminController {
    constructor(
        private readonly admin: AdminService,
        private readonly redeem: RedeemService,
        private readonly piapi: PiapiPoolService,
        private readonly settings: SettingsService,
        private readonly audit: AuditService,
        private readonly openapi: OpenApiService,
    ) {}

    @Get("overview")
    @ApiOperation({ summary: "仪表盘统计" })
    overview() {
        return this.admin.overview();
    }

    @Get("users")
    @ApiOperation({ summary: "用户列表，含余额" })
    users(@Query() query: UserQueryDto) {
        return this.admin.listUsers(query);
    }

    @Patch("users/:id")
    @Audit({ action: "user.update", targetType: "user" })
    @ApiOperation({ summary: "修改用户角色、状态、昵称或重置密码" })
    updateUser(@Param("id") id: string, @Body() body: UpdateUserDto) {
        return this.admin.updateUser(id, body);
    }

    @Post("users/delete")
    @Audit({ action: "user.delete", targetType: "user" })
    @ApiOperation({ summary: "批量删除用户，级联其画布、文件、任务与流水" })
    deleteUsers(@CurrentUser() user: AuthUser, @Body() body: DeleteManyDto) {
        return this.admin.deleteUsers(body.ids, user.id);
    }

    @Post("users/:id/balance")
    @Audit({ action: "wallet.adjust", targetType: "user" })
    @ApiOperation({ summary: "调整用户余额，正数增加负数扣减" })
    adjustBalance(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: AdjustBalanceDto) {
        return this.admin.adjustBalance(id, body, user.id);
    }

    @Get("users/:id/ledger")
    @ApiOperation({ summary: "指定用户的余额流水" })
    userLedger(@Param("id") id: string, @Query() query: PaginationDto) {
        return this.admin.userLedger(id, query);
    }

    @Get("channels")
    @ApiOperation({ summary: "渠道、模型与价格，密钥只返回是否已配置" })
    channels() {
        return this.admin.listChannels();
    }

    @Post("channels")
    @Audit({ action: "channel.create", targetType: "channel" })
    @ApiOperation({ summary: "新增渠道" })
    createChannel(@Body() body: UpsertChannelDto) {
        return this.admin.createChannel(body);
    }

    @Patch("channels/:id")
    @Audit({ action: "channel.update", targetType: "channel" })
    @ApiOperation({ summary: "修改渠道，apiKey 留空表示不改" })
    updateChannel(@Param("id") id: string, @Body() body: UpsertChannelDto) {
        return this.admin.updateChannel(id, body);
    }

    @Delete("channels/:id")
    @Audit({ action: "channel.delete", targetType: "channel" })
    @ApiOperation({ summary: "删除渠道" })
    deleteChannel(@Param("id") id: string) {
        return this.admin.deleteChannel(id);
    }

    @Post("channels/:id/models")
    @Audit({ action: "model.upsert", targetType: "channel_model" })
    @ApiOperation({ summary: "新增或更新渠道模型" })
    upsertModel(@Param("id") id: string, @Body() body: ChannelModelDto) {
        return this.admin.upsertModel(id, body);
    }

    @Delete("models/:id")
    @Audit({ action: "model.delete", targetType: "channel_model" })
    @ApiOperation({ summary: "删除渠道模型" })
    deleteModel(@Param("id") id: string) {
        return this.admin.deleteModel(id);
    }

    @Post("models/:id/prices")
    @Audit({ action: "price.upsert", targetType: "model_price" })
    @ApiOperation({ summary: "设置模型价格与计费方式" })
    upsertPrice(@Param("id") id: string, @Body() body: UpsertPriceDto) {
        return this.admin.upsertPrice(id, body);
    }

    @Delete("prices/:id")
    @Audit({ action: "price.delete", targetType: "model_price" })
    @ApiOperation({ summary: "删除价格" })
    deletePrice(@Param("id") id: string) {
        return this.admin.deletePrice(id);
    }

    @Get("tasks")
    @ApiOperation({ summary: "全站生成任务记录" })
    tasks(@Query() query: AdminTaskQueryDto) {
        return this.admin.listTasks(query);
    }

    @Get("orders")
    @ApiOperation({ summary: "全站充值订单" })
    orders(@Query() query: PaginationDto) {
        return this.admin.listAllOrders(query);
    }

    @Get("ledger")
    @ApiOperation({ summary: "全站余额流水" })
    ledger(@Query() query: AdminLedgerQueryDto) {
        return this.admin.listAllLedger(query);
    }

    @Get("reconcile")
    @ApiOperation({ summary: "对账：列出流水累加与余额不一致的钱包" })
    async reconcile() {
        return { mismatches: await this.admin.reconcile() };
    }

    @Get("cards")
    @ApiOperation({ summary: "卡密批次列表" })
    cardBatches(@Query() query: CardBatchQueryDto) {
        return this.redeem.listBatches(query);
    }

    @Post("cards")
    @Audit({ action: "card.create_batch", targetType: "card_batch" })
    @ApiOperation({ summary: "批量生成卡密" })
    async createCards(@CurrentUser() user: AuthUser, @Body() body: CreateCardBatchDto) {
        const result = await this.redeem.createBatch({
            name: body.name,
            faceValue: body.faceValue,
            quantity: body.quantity,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
            createdBy: user.id,
        });
        return { batchId: result.batch.id, codes: result.cards.map((card) => card.code), audit: { targetId: result.batch.id, after: { faceValue: body.faceValue, quantity: body.quantity } } };
    }

    @Get("cards/:batchId/items")
    @ApiOperation({ summary: "批次内的卡密" })
    cards(@Param("batchId") batchId: string, @Query() query: CardItemsQueryDto) {
        return this.redeem.listCards({ ...query, batchId });
    }

    @Get("cards/:batchId/export")
    @ApiOperation({ summary: "导出批次卡密" })
    async exportCards(@Param("batchId") batchId: string) {
        return { cards: await this.redeem.exportBatch(batchId) };
    }

    @Post("cards/void")
    @Audit({ action: "card.void", targetType: "card" })
    @ApiOperation({ summary: "作废未使用的卡密" })
    async voidCards(@Body() body: DeleteManyDto) {
        return { voided: await this.redeem.voidCards(body.ids) };
    }

    @Post("cards/delete")
    @Audit({ action: "card.delete", targetType: "card" })
    @ApiOperation({ summary: "删除卡密，已兑换流水仍保留" })
    async deleteCards(@Body() body: DeleteManyDto) {
        const removed = await this.redeem.deleteCards(body.ids);
        return { removed, audit: { targetId: body.ids[0] ?? "", after: { ids: body.ids, removed } } };
    }

    @Post("cards/batches/delete")
    @Audit({ action: "card.delete_batch", targetType: "card_batch" })
    @ApiOperation({ summary: "删除卡密批次及其卡密" })
    async deleteCardBatches(@Body() body: DeleteManyDto) {
        const removed = await this.redeem.deleteBatches(body.ids);
        return { removed, audit: { targetId: body.ids[0] ?? "", after: { ids: body.ids, removed } } };
    }

    @Get("settings")
    @ApiOperation({ summary: "站点与存储设置，密钥已脱敏" })
    getSettings() {
        return this.admin.getSettings();
    }

    @Patch("settings/site")
    @Audit({ action: "settings.site", targetType: "settings" })
    @ApiOperation({ summary: "保存站点设置" })
    async saveSite(@CurrentUser() user: AuthUser, @Body() body: SiteSettingsDto) {
        const saved = await this.settings.saveSite({ ...body, rechargeNotice: body.rechargeNotice ?? "" }, user.id);
        return { site: saved, audit: { targetId: "site", after: saved } };
    }

    @Patch("settings/services")
    @Audit({ action: "settings.services", targetType: "settings" })
    @ApiOperation({ summary: "开关图片生成、视频生成与 Agent 前台入口" })
    async saveServices(@CurrentUser() user: AuthUser, @Body() body: ServiceSettingsDto) {
        const before = await this.settings.getSite();
        const saved = await this.settings.saveSite(body, user.id);
        return {
            site: saved,
            audit: {
                targetId: "services",
                before: { imageGenerationEnabled: before.imageGenerationEnabled, videoGenerationEnabled: before.videoGenerationEnabled, agentEnabled: before.agentEnabled },
                after: { imageGenerationEnabled: saved.imageGenerationEnabled, videoGenerationEnabled: saved.videoGenerationEnabled, agentEnabled: saved.agentEnabled },
            },
        };
    }

    @Patch("settings/storage")
    @Audit({ action: "settings.storage", targetType: "settings" })
    @ApiOperation({ summary: "切换存储策略与 S3 凭据" })
    saveStorage(@CurrentUser() user: AuthUser, @Body() body: StorageSettingsDto) {
        return this.admin.saveStorageSettings(body, user.id);
    }

    @Get("piapi")
    @ApiOperation({ summary: "PiAPI 账号池" })
    piapiAccounts() {
        return this.admin.listPiapiAccounts();
    }

    @Post("piapi/ensure-channel")
    @Audit({ action: "piapi.ensure_channel", targetType: "channel" })
    @ApiOperation({ summary: "预置 PiAPI 渠道与四个 Seedream 模型（幂等，不覆盖已有价格）" })
    ensurePiapiChannel() {
        return this.admin.ensurePiapiChannel();
    }

    @Post("whatstoken/ensure-channel")
    @Audit({ action: "whatstoken.ensure_channel", targetType: "channel" })
    @ApiOperation({ summary: "预置 WhatsToken 渠道与 Seedream/Seedance 模型（幂等，不覆盖已有价格）" })
    ensureWhatsTokenChannel() {
        return this.admin.ensureWhatsTokenChannel();
    }

    @Post("piapi/import")
    @Audit({ action: "piapi.import", targetType: "piapi_account" })
    @ApiOperation({ summary: "批量导入 PiAPI 账号" })
    async importPiapi(@Body() body: ImportPiapiDto) {
        const result = await this.piapi.importAccounts(body.accounts);
        return { ...result, audit: { targetId: "piapi", after: result } };
    }

    @Post("piapi/refresh")
    @ApiOperation({ summary: "刷新全部 PiAPI 账号余额" })
    async refreshPiapi() {
        return { refreshed: await this.piapi.refreshAll() };
    }

    @Post("piapi/status")
    @Audit({ action: "piapi.status", targetType: "piapi_account" })
    @ApiOperation({ summary: "启用或停用账号" })
    async setPiapiStatus(@Body() body: DeleteManyDto & { status: "active" | "disabled" }) {
        return { updated: await this.admin.setPiapiStatus(body.ids, body.status) };
    }

    @Post("piapi/delete")
    @Audit({ action: "piapi.delete", targetType: "piapi_account" })
    @ApiOperation({ summary: "删除账号" })
    async deletePiapi(@Body() body: DeleteManyDto) {
        return { removed: await this.admin.deletePiapiAccounts(body.ids) };
    }

    @Get("audit")
    @ApiOperation({ summary: "审计日志" })
    auditLogs(@Query() query: PaginationDto & { action?: string }) {
        return this.audit.list(query);
    }

    @Get("openapi.json")
    @ApiExcludeEndpoint()
    @Header("Cache-Control", "no-store")
    openapiJson() {
        return this.openapi.getDocument();
    }

    @Get("docs")
    @ApiExcludeEndpoint()
    docs(@Res() reply: FastifyReply) {
        return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(this.openapi.docsHtml());
    }

    @Get("docs/:file")
    @ApiExcludeEndpoint()
    docsAsset(@Param("file") file: string, @Res() reply: FastifyReply) {
        const asset = this.openapi.openAsset(file);
        return reply.type(asset.contentType).send(asset.stream);
    }
}
