import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { DB, type Database } from "../../db/db.module";
import { channelModels, channels, generationTasks, modelPrices, orders, piapiAccounts, users, walletLedger, wallets } from "../../db/schema";
import { badRequest, conflict, forbidden, notFound } from "../../common/errors";
import { isNegative, money, toMoneyString } from "../../common/money";
import type { Paginated } from "../../common/types";
import { AuthService } from "../auth/auth.service";
import { SessionService } from "../auth/session.service";
import { CryptoService } from "../crypto/crypto.service";
import { seedPiapiChannel } from "../generation/piapi-channel.seed";
import { seedWhatsTokenChannel } from "../generation/whatstoken-channel.seed";
import { parseModelFeatures } from "../pricing/model-features";
import { PricingService } from "../pricing/pricing.service";
import { SettingsService, type StorageSettings } from "../settings/settings.service";
import { StorageService } from "../storage/storage.service";
import { WalletService } from "../wallet/wallet.service";
import type { AdjustBalanceDto, AdminLedgerQueryDto, AdminTaskQueryDto, ChannelModelDto, StorageSettingsDto, UpdateUserDto, UpsertChannelDto, UpsertPriceDto, UserQueryDto } from "./dto/admin.dto";

@Injectable()
export class AdminService implements OnModuleInit {
    private readonly logger = new Logger(AdminService.name);

    constructor(
        @Inject(DB) private readonly db: Database,
        private readonly crypto: CryptoService,
        private readonly pricing: PricingService,
        private readonly wallet: WalletService,
        private readonly sessions: SessionService,
        private readonly settings: SettingsService,
        private readonly storage: StorageService,
    ) {}

    /** API process only — WorkerModule does not import AdminModule. */
    async onModuleInit() {
        const piapi = await this.ensurePiapiChannel();
        this.logger.log(
            `PiAPI channel ${piapi.created ? "created" : "ensured"} ${piapi.id}: modelsCreated=${piapi.modelsCreated} pricesInserted=${piapi.pricesInserted}`,
        );
        const whatsToken = await this.ensureWhatsTokenChannel();
        this.logger.log(
            `WhatsToken channel ${whatsToken.created ? "created" : "ensured"} ${whatsToken.id}: modelsCreated=${whatsToken.modelsCreated} pricesInserted=${whatsToken.pricesInserted} keyUpdated=${whatsToken.keyUpdated}`,
        );
    }

    /** Creates the PiAPI channel and four Seedream models if missing; never overwrites existing prices. */
    async ensurePiapiChannel() {
        const result = await seedPiapiChannel(this.db);
        await this.pricing.invalidate();
        return {
            ...result,
            audit: { targetId: result.id, after: { name: result.name, created: result.created, modelsCreated: result.modelsCreated, pricesInserted: result.pricesInserted } },
        };
    }

    /** Creates the WhatsToken OpenAI channel and Seedream/Seedance models if missing; never overwrites existing prices or keys. */
    async ensureWhatsTokenChannel() {
        const result = await seedWhatsTokenChannel(this.db, {
            apiKey: process.env.WHATSTOKEN_API_KEY?.trim() || undefined,
            crypto: this.crypto,
        });
        await this.pricing.invalidate();
        return {
            ...result,
            audit: { targetId: result.id, after: { name: result.name, created: result.created, modelsCreated: result.modelsCreated, pricesInserted: result.pricesInserted, keyUpdated: result.keyUpdated } },
        };
    }

    /** Dashboard aggregates. Kept to a handful of cheap counts so the page stays fast. */
    async overview() {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const [[userStats], [walletStats], [taskStats], [revenue]] = await Promise.all([
            this.db.select({ total: sql<number>`count(*)::int`, active: sql<number>`count(*) filter (where ${users.status} = 'active')::int` }).from(users),
            this.db
                .select({
                    balance: sql<string>`coalesce(sum(${wallets.balance}), 0)::text`,
                    frozen: sql<string>`coalesce(sum(${wallets.frozen}), 0)::text`,
                    spent: sql<string>`coalesce(sum(${wallets.totalSpent}), 0)::text`,
                })
                .from(wallets),
            this.db
                .select({
                    total: sql<number>`count(*)::int`,
                    running: sql<number>`count(*) filter (where ${generationTasks.status} in ('pending','running'))::int`,
                    failed7d: sql<number>`count(*) filter (where ${generationTasks.status} = 'failed' and ${generationTasks.createdAt} >= ${since})::int`,
                })
                .from(generationTasks),
            this.db.select({ total: sql<string>`coalesce(sum(${orders.amount}), 0)::text` }).from(orders).where(eq(orders.status, "paid")),
        ]);

        return {
            users: userStats,
            wallet: { balance: toMoneyString(walletStats.balance), frozen: toMoneyString(walletStats.frozen), spent: toMoneyString(walletStats.spent) },
            tasks: taskStats,
            revenue: toMoneyString(revenue.total),
        };
    }

    async listUsers(query: UserQueryDto): Promise<Paginated<Record<string, unknown>>> {
        const filters = [
            query.keyword ? or(ilike(users.username, `%${query.keyword}%`), ilike(users.displayName, `%${query.keyword}%`)) : undefined,
            query.role ? eq(users.role, query.role) : undefined,
            query.status ? eq(users.status, query.status) : undefined,
        ].filter(Boolean);
        const where = filters.length ? and(...filters) : undefined;

        const [items, [counted]] = await Promise.all([
            this.db
                .select({
                    id: users.id,
                    username: users.username,
                    role: users.role,
                    status: users.status,
                    displayName: users.displayName,
                    lastLoginAt: users.lastLoginAt,
                    createdAt: users.createdAt,
                    balance: wallets.balance,
                    frozen: wallets.frozen,
                    totalSpent: wallets.totalSpent,
                    totalRecharged: wallets.totalRecharged,
                })
                .from(users)
                .leftJoin(wallets, eq(wallets.userId, users.id))
                .where(where)
                .orderBy(desc(users.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(users).where(where),
        ]);
        return { items, total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    async updateUser(id: string, input: UpdateUserDto) {
        const [before] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
        if (!before) throw notFound("用户不存在");

        const [after] = await this.db
            .update(users)
            .set({
                ...(input.role === undefined ? {} : { role: input.role }),
                ...(input.status === undefined ? {} : { status: input.status }),
                ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
                ...(input.password === undefined ? {} : { passwordHash: await AuthService.hashPassword(input.password) }),
                updatedAt: new Date(),
            })
            .where(eq(users.id, id))
            .returning();

        // Disabling an account or changing its password must take effect immediately, not at token expiry.
        if (input.status === "disabled" || input.password) await this.sessions.revokeAllForUser(id);
        else if (input.role && input.role !== before.role) await this.sessions.refreshPayload(id, { userId: id, username: after.username, role: after.role });

        return { user: sanitizeUser(after), audit: { targetId: id, before: sanitizeUser(before), after: sanitizeUser(after) } };
    }

    /**
     * Hard-deletes users and cascades their projects, files, tasks and ledger.
     * Refuses the current operator, the last remaining admin, and anyone with in-flight billing.
     */
    async deleteUsers(ids: string[], operatorId: string) {
        const unique = [...new Set(ids.filter(Boolean))];
        if (!unique.length) throw badRequest("EMPTY_IDS", "请选择要删除的用户");
        if (unique.includes(operatorId)) throw forbidden("不能删除当前登录账号");

        const targets = await this.db.select({ id: users.id, username: users.username, role: users.role }).from(users).where(inArray(users.id, unique));
        if (!targets.length) throw notFound("用户不存在");

        const deletingAdminIds = targets.filter((user) => user.role === "admin").map((user) => user.id);
        if (deletingAdminIds.length) {
            const [counted] = await this.db.select({ total: sql<number>`count(*)::int` }).from(users).where(eq(users.role, "admin"));
            if ((counted?.total ?? 0) - deletingAdminIds.length < 1) throw forbidden("不能删除最后一个管理员");
        }

        const targetIds = targets.map((user) => user.id);
        const [busy] = await this.db
            .select({ total: sql<number>`count(*)::int` })
            .from(generationTasks)
            .where(and(inArray(generationTasks.userId, targetIds), inArray(generationTasks.status, ["pending", "running"])));
        if (busy?.total) throw conflict("USER_HAS_ACTIVE_TASKS", "选中用户有进行中的生成任务，请等任务结束后再删除");

        const [frozen] = await this.db
            .select({ total: sql<number>`count(*)::int` })
            .from(wallets)
            .where(and(inArray(wallets.userId, targetIds), sql`${wallets.frozen} > 0`));
        if (frozen?.total) throw conflict("USER_HAS_FROZEN_BALANCE", "选中用户有冻结余额，请等任务结算后再删除");

        for (const id of targetIds) {
            await this.sessions.revokeAllForUser(id);
            await this.storage.purgeAllForOwner(id);
        }

        const removed = await this.db.delete(users).where(inArray(users.id, targetIds)).returning({ id: users.id, username: users.username, role: users.role });
        return {
            removed: removed.length,
            audit: { targetId: removed[0]?.id ?? "", before: { users: removed.map((user) => ({ id: user.id, username: user.username, role: user.role })) } },
        };
    }

    /** Positive adds balance, negative deducts. Both paths go through WalletService. */
    async adjustBalance(userId: string, input: AdjustBalanceDto, operatorId: string) {
        const amount = money(input.amount);
        if (amount.isZero()) throw badRequest("INVALID_AMOUNT", "调整金额不能为 0");

        const wallet = isNegative(amount)
            ? await this.wallet.debitByAdmin({ userId, amount: amount.abs(), operatorId, note: input.note })
            : (await this.wallet.credit({ userId, amount, type: "admin_adjust", paymentProvider: "admin", operatorId, note: input.note })).wallet;

        return { balance: wallet.balance, audit: { targetId: userId, after: { amount: input.amount, note: input.note, balance: wallet.balance } } };
    }

    async userLedger(userId: string, query: { page: number; pageSize: number }) {
        return this.wallet.listLedger(userId, query);
    }

    async listChannels() {
        const rows = await this.db.select().from(channels).orderBy(desc(channels.priority));
        const models = await this.db.select().from(channelModels);
        const prices = await this.db.select().from(modelPrices);

        return rows.map((channel) => ({
            id: channel.id,
            name: channel.name,
            baseUrl: channel.baseUrl,
            apiFormat: channel.apiFormat,
            enabled: channel.enabled,
            priority: channel.priority,
            // Never return the key, only whether one is stored.
            hasApiKey: Boolean(channel.apiKeyCipher),
            createdAt: channel.createdAt,
            models: models
                .filter((model) => model.channelId === channel.id)
                .map((model) => ({
                    id: model.id,
                    name: model.name,
                    displayName: model.displayName,
                    capability: model.capability,
                    enabled: model.enabled,
                    hasScript: Boolean(model.script.trim()),
                    features: parseModelFeatures(model.features),
                    prices: prices.filter((price) => price.channelModelId === model.id),
                })),
        }));
    }

    async createChannel(input: UpsertChannelDto) {
        const encrypted = input.apiKey ? this.crypto.encrypt(input.apiKey) : { cipher: "", keyId: "" };
        const [created] = await this.db
            .insert(channels)
            .values({
                name: input.name,
                baseUrl: input.baseUrl,
                apiFormat: input.apiFormat,
                apiKeyCipher: encrypted.cipher,
                apiKeyId: encrypted.keyId,
                enabled: input.enabled ?? true,
                priority: input.priority ?? 100,
            })
            .returning();
        await this.pricing.invalidate();
        return { id: created.id, audit: { targetId: created.id, after: { name: created.name, baseUrl: created.baseUrl, apiFormat: created.apiFormat } } };
    }

    async updateChannel(id: string, input: UpsertChannelDto) {
        const [before] = await this.db.select().from(channels).where(eq(channels.id, id)).limit(1);
        if (!before) throw notFound("渠道不存在");
        // An empty apiKey means "leave the stored one alone", so an admin can edit a channel without re-typing it.
        const encrypted = input.apiKey ? this.crypto.encrypt(input.apiKey) : null;

        const [after] = await this.db
            .update(channels)
            .set({
                name: input.name,
                baseUrl: input.baseUrl,
                apiFormat: input.apiFormat,
                ...(encrypted ? { apiKeyCipher: encrypted.cipher, apiKeyId: encrypted.keyId } : {}),
                enabled: input.enabled ?? before.enabled,
                priority: input.priority ?? before.priority,
                updatedAt: new Date(),
            })
            .where(eq(channels.id, id))
            .returning();
        await this.pricing.invalidate();
        return { id, audit: { targetId: id, before: auditChannel(before), after: auditChannel(after) } };
    }

    async deleteChannel(id: string) {
        const removed = await this.db.delete(channels).where(eq(channels.id, id)).returning({ id: channels.id, name: channels.name });
        if (!removed.length) throw notFound("渠道不存在");
        await this.pricing.invalidate();
        return { id, audit: { targetId: id, before: { name: removed[0].name } } };
    }

    async upsertModel(channelId: string, input: ChannelModelDto) {
        const features = input.features === undefined ? undefined : parseModelFeatures(input.features);
        const [model] = await this.db
            .insert(channelModels)
            .values({
                channelId,
                name: input.name,
                displayName: input.displayName ?? "",
                capability: input.capability,
                enabled: input.enabled ?? true,
                script: input.script ?? "",
                features: features ?? parseModelFeatures({}),
            })
            .onConflictDoUpdate({
                target: [channelModels.channelId, channelModels.name],
                set: {
                    displayName: input.displayName ?? "",
                    capability: input.capability,
                    enabled: input.enabled ?? true,
                    ...(input.script === undefined ? {} : { script: input.script }),
                    ...(features === undefined ? {} : { features }),
                    updatedAt: new Date(),
                },
            })
            .returning();
        await this.pricing.invalidate();
        return { id: model.id, audit: { targetId: model.id, after: { name: model.name, capability: model.capability, features: parseModelFeatures(model.features) } } };
    }

    async deleteModel(id: string) {
        const removed = await this.db.delete(channelModels).where(eq(channelModels.id, id)).returning({ id: channelModels.id, name: channelModels.name });
        if (!removed.length) throw notFound("模型不存在");
        await this.pricing.invalidate();
        return { id, audit: { targetId: id, before: { name: removed[0].name } } };
    }

    async upsertPrice(channelModelId: string, input: UpsertPriceDto) {
        const spec = input.spec?.trim() || null;
        const [existing] = await this.db
            .select()
            .from(modelPrices)
            .where(and(eq(modelPrices.channelModelId, channelModelId), spec ? eq(modelPrices.spec, spec) : sql`${modelPrices.spec} is null`))
            .limit(1);

        const values = {
            channelModelId,
            billingMode: input.billingMode,
            spec,
            unitPrice: toMoneyString(input.unitPrice),
            extraReferencePrice: toMoneyString(input.extraReferencePrice ?? 0),
            minCharge: toMoneyString(input.minCharge ?? 0),
        };

        const [saved] = existing
            ? await this.db.update(modelPrices).set({ ...values, updatedAt: new Date() }).where(eq(modelPrices.id, existing.id)).returning()
            : await this.db.insert(modelPrices).values(values).returning();

        await this.pricing.invalidate();
        return { id: saved.id, audit: { targetId: saved.id, before: existing ? auditPrice(existing) : null, after: auditPrice(saved) } };
    }

    async deletePrice(id: string) {
        const removed = await this.db.delete(modelPrices).where(eq(modelPrices.id, id)).returning();
        if (!removed.length) throw notFound("价格不存在");
        await this.pricing.invalidate();
        return { id, audit: { targetId: id, before: auditPrice(removed[0]) } };
    }

    async listTasks(query: AdminTaskQueryDto): Promise<Paginated<Record<string, unknown>>> {
        const keyword = query.keyword?.trim();
        const filters = [
            query.status ? eq(generationTasks.status, query.status) : undefined,
            query.userId ? eq(generationTasks.userId, query.userId) : undefined,
            query.capability ? eq(generationTasks.capability, query.capability) : undefined,
            keyword ? or(ilike(users.username, `%${keyword}%`), ilike(generationTasks.modelName, `%${keyword}%`), ilike(generationTasks.error, `%${keyword}%`)) : undefined,
        ].filter(Boolean);
        const where = filters.length ? and(...filters) : undefined;

        const [items, [counted]] = await Promise.all([
            this.db
                .select({
                    id: generationTasks.id,
                    username: users.username,
                    capability: generationTasks.capability,
                    modelName: generationTasks.modelName,
                    status: generationTasks.status,
                    quantity: generationTasks.quantity,
                    succeededCount: generationTasks.succeededCount,
                    estimatedCost: generationTasks.estimatedCost,
                    actualCost: generationTasks.actualCost,
                    error: generationTasks.error,
                    createdAt: generationTasks.createdAt,
                    finishedAt: generationTasks.finishedAt,
                })
                .from(generationTasks)
                .leftJoin(users, eq(users.id, generationTasks.userId))
                .where(where)
                .orderBy(desc(generationTasks.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db
                .select({ total: sql<number>`count(*)::int` })
                .from(generationTasks)
                .leftJoin(users, eq(users.id, generationTasks.userId))
                .where(where),
        ]);
        return { items, total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    async listAllOrders(query: { page: number; pageSize: number }): Promise<Paginated<Record<string, unknown>>> {
        const [items, [counted]] = await Promise.all([
            this.db
                .select({
                    id: orders.id,
                    orderNo: orders.orderNo,
                    username: users.username,
                    amount: orders.amount,
                    status: orders.status,
                    paymentProvider: orders.paymentProvider,
                    paidAt: orders.paidAt,
                    createdAt: orders.createdAt,
                })
                .from(orders)
                .leftJoin(users, eq(users.id, orders.userId))
                .orderBy(desc(orders.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(orders),
        ]);
        return { items, total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    async listAllLedger(query: AdminLedgerQueryDto): Promise<Paginated<Record<string, unknown>>> {
        const keyword = query.keyword?.trim();
        const filters = [
            query.type ? eq(walletLedger.type, query.type) : undefined,
            keyword ? or(ilike(users.username, `%${keyword}%`), ilike(walletLedger.note, `%${keyword}%`)) : undefined,
        ].filter(Boolean);
        const where = filters.length ? and(...filters) : undefined;

        const [items, [counted]] = await Promise.all([
            this.db
                .select({
                    id: walletLedger.id,
                    username: users.username,
                    type: walletLedger.type,
                    amount: walletLedger.amount,
                    balanceAfter: walletLedger.balanceAfter,
                    note: walletLedger.note,
                    createdAt: walletLedger.createdAt,
                })
                .from(walletLedger)
                .leftJoin(users, eq(users.id, walletLedger.userId))
                .where(where)
                .orderBy(desc(walletLedger.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db
                .select({ total: sql<number>`count(*)::int` })
                .from(walletLedger)
                .leftJoin(users, eq(users.id, walletLedger.userId))
                .where(where),
        ]);
        return { items, total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    reconcile() {
        return this.wallet.reconcileAll();
    }

    async getSettings() {
        const [site, storage] = await Promise.all([this.settings.getSite(), this.settings.getStorage()]);
        // Mask the stored secret; the client sends a value only when it wants to change it.
        return { site, storage: { ...storage, s3: { ...storage.s3, secretAccessKeyCipher: "", hasSecret: Boolean(storage.s3.secretAccessKeyCipher) } } };
    }

    async saveStorageSettings(input: StorageSettingsDto, operatorId: string) {
        const current = await this.settings.getStorage();
        const encrypted = input.s3?.secretAccessKey ? this.crypto.encrypt(input.s3.secretAccessKey) : null;
        const next: StorageSettings = {
            driver: input.driver,
            s3: {
                endpoint: input.s3?.endpoint ?? current.s3.endpoint,
                region: input.s3?.region ?? current.s3.region,
                bucket: input.s3?.bucket ?? current.s3.bucket,
                accessKeyId: input.s3?.accessKeyId ?? current.s3.accessKeyId,
                secretAccessKeyCipher: encrypted?.cipher ?? current.s3.secretAccessKeyCipher,
                secretAccessKeyId: encrypted?.keyId ?? current.s3.secretAccessKeyId,
                forcePathStyle: input.s3?.forcePathStyle ?? current.s3.forcePathStyle,
                publicBaseUrl: input.s3?.publicBaseUrl ?? current.s3.publicBaseUrl,
            },
        };
        if (next.driver === "s3" && !next.s3.bucket) throw badRequest("STORAGE_INCOMPLETE", "切换到 S3 前必须填写 bucket");

        await this.settings.saveStorage(next, operatorId);
        return { audit: { targetId: "storage", before: { driver: current.driver }, after: { driver: next.driver, bucket: next.s3.bucket } } };
    }

    async listPiapiAccounts() {
        const rows = await this.db.select().from(piapiAccounts).orderBy(desc(piapiAccounts.createdAt));
        return rows.map((row) => ({
            id: row.id,
            username: row.username,
            apiKeyMask: CryptoService.mask(row.apiKeyTail),
            status: row.status,
            balanceUsd: row.balanceUsd,
            usedCount: row.usedCount,
            checkedAt: row.checkedAt,
            lastError: row.lastError,
        }));
    }

    async setPiapiStatus(ids: string[], status: "active" | "disabled") {
        if (!ids.length) return 0;
        const updated = await this.db
            .update(piapiAccounts)
            .set({ status, lastError: "", updatedAt: new Date() })
            .where(sql`${piapiAccounts.id} = any(${sql.param(ids)}::uuid[])`)
            .returning({ id: piapiAccounts.id });
        return updated.length;
    }

    async deletePiapiAccounts(ids: string[]) {
        if (!ids.length) return 0;
        const removed = await this.db
            .delete(piapiAccounts)
            .where(sql`${piapiAccounts.id} = any(${sql.param(ids)}::uuid[])`)
            .returning({ id: piapiAccounts.id });
        return removed.length;
    }
}

function sanitizeUser(user: typeof users.$inferSelect) {
    return { id: user.id, username: user.username, role: user.role, status: user.status, displayName: user.displayName };
}

function auditChannel(channel: typeof channels.$inferSelect) {
    return { name: channel.name, baseUrl: channel.baseUrl, apiFormat: channel.apiFormat, enabled: channel.enabled, priority: channel.priority };
}

function auditPrice(price: typeof modelPrices.$inferSelect) {
    return { billingMode: price.billingMode, spec: price.spec, unitPrice: price.unitPrice, extraReferencePrice: price.extraReferencePrice, minCharge: price.minCharge };
}
