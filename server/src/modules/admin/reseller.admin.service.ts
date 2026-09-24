import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { DB, type Database } from "../../db/db.module";
import { apiKeys, apiUsageDaily, resellerAccounts, resellerTiers, users } from "../../db/schema";
import { badRequest, conflict, notFound } from "../../common/errors";
import { toMoneyString } from "../../common/money";
import type { Paginated } from "../../common/types";
import { effectiveMultiplier } from "../pricing/reseller-multiplier";
import { ResellerPricingService } from "../pricing/reseller-pricing.service";
import { ApiKeyService } from "../openapi/api-key.service";
import type { ResellerListQueryDto, ReviewResellerDto, UpdateResellerDto, UpsertResellerTierDto } from "./dto/reseller-admin.dto";
import { seedResellerTiers } from "./reseller-tiers.seed";

/**
 * Admin-side reseller administration: tiers, applications, and per-account overrides.
 *
 * Anything that changes a coefficient also drops the pricing cache and the API-key cache, because
 * both are read on the billing hot path and a stale entry would quietly charge the wrong price.
 */
@Injectable()
export class ResellerAdminService implements OnModuleInit {
    private readonly logger = new Logger(ResellerAdminService.name);

    constructor(
        @Inject(DB) private readonly db: Database,
        private readonly pricing: ResellerPricingService,
        private readonly keys: ApiKeyService,
    ) {}

    async onModuleInit() {
        const { created } = await seedResellerTiers(this.db);
        if (created) this.logger.log(`Seeded ${created} reseller tiers`);
    }

    async listTiers() {
        const rows = await this.db
            .select({
                id: resellerTiers.id,
                name: resellerTiers.name,
                multiplier: resellerTiers.multiplier,
                description: resellerTiers.description,
                isDefault: resellerTiers.isDefault,
                sortOrder: resellerTiers.sortOrder,
                createdAt: resellerTiers.createdAt,
                resellerCount: sql<number>`(select count(*) from ${resellerAccounts} where ${resellerAccounts.tierId} = ${resellerTiers.id})::int`,
            })
            .from(resellerTiers)
            .orderBy(asc(resellerTiers.sortOrder), asc(resellerTiers.name));
        return { items: rows };
    }

    async createTier(input: UpsertResellerTierDto) {
        this.assertMultiplier(input.multiplier);
        const [row] = await this.db
            .insert(resellerTiers)
            .values({
                name: input.name.trim(),
                multiplier: toMoneyString(input.multiplier),
                description: input.description?.trim() ?? "",
                isDefault: input.isDefault ?? false,
                sortOrder: input.sortOrder ?? 100,
            })
            .onConflictDoNothing()
            .returning();
        if (!row) throw conflict("TIER_NAME_TAKEN", "同名等级已存在");
        if (row.isDefault) await this.clearOtherDefaults(row.id);
        await this.pricing.invalidateAll();
        return row;
    }

    async updateTier(id: string, input: UpsertResellerTierDto) {
        this.assertMultiplier(input.multiplier);
        const existing = await this.tier(id);
        const [row] = await this.db
            .update(resellerTiers)
            .set({
                name: input.name.trim(),
                multiplier: toMoneyString(input.multiplier),
                description: input.description?.trim() ?? "",
                isDefault: input.isDefault ?? existing.isDefault,
                sortOrder: input.sortOrder ?? existing.sortOrder,
                updatedAt: new Date(),
            })
            .where(eq(resellerTiers.id, id))
            .returning();
        if (row.isDefault) await this.clearOtherDefaults(row.id);
        // A tier's coefficient reaches every account on it, so both caches have to go.
        await this.pricing.invalidateAll();
        await this.invalidateTierKeys(id);
        return row;
    }

    async removeTier(id: string) {
        const [inUse] = await this.db
            .select({ total: sql<number>`count(*)::int` })
            .from(resellerAccounts)
            .where(eq(resellerAccounts.tierId, id));
        if ((inUse?.total ?? 0) > 0) throw badRequest("TIER_IN_USE", "该等级下仍有代理商，请先调整他们的等级");
        await this.db.delete(resellerTiers).where(eq(resellerTiers.id, id));
        await this.pricing.invalidateAll();
        return { removed: 1 };
    }

    async list(query: ResellerListQueryDto): Promise<Paginated<Record<string, unknown>>> {
        const filters = [];
        if (query.status) filters.push(eq(resellerAccounts.status, query.status));
        if (query.tierId) filters.push(eq(resellerAccounts.tierId, query.tierId));
        if (query.keyword?.trim()) {
            const like = `%${query.keyword.trim()}%`;
            filters.push(or(ilike(users.username, like), ilike(resellerAccounts.companyName, like))!);
        }
        const where = filters.length ? and(...filters) : undefined;

        const [items, [counted]] = await Promise.all([
            this.db
                .select({
                    userId: resellerAccounts.userId,
                    username: users.username,
                    userStatus: users.status,
                    role: users.role,
                    status: resellerAccounts.status,
                    tierId: resellerAccounts.tierId,
                    tierName: resellerTiers.name,
                    tierMultiplier: resellerTiers.multiplier,
                    multiplierOverride: resellerAccounts.multiplierOverride,
                    companyName: resellerAccounts.companyName,
                    contactEmail: resellerAccounts.contactEmail,
                    website: resellerAccounts.website,
                    useCase: resellerAccounts.useCase,
                    rejectReason: resellerAccounts.rejectReason,
                    appliedAt: resellerAccounts.appliedAt,
                    reviewedAt: resellerAccounts.reviewedAt,
                    keyCount: sql<number>`(select count(*) from ${apiKeys} where ${apiKeys.userId} = ${resellerAccounts.userId})::int`,
                    requests: sql<number>`(select coalesce(sum(requests), 0) from ${apiUsageDaily} where ${apiUsageDaily.userId} = ${resellerAccounts.userId})::int`,
                    billedAmount: sql<string>`(select coalesce(sum(billed_amount), 0) from ${apiUsageDaily} where ${apiUsageDaily.userId} = ${resellerAccounts.userId})::text`,
                })
                .from(resellerAccounts)
                .innerJoin(users, eq(users.id, resellerAccounts.userId))
                .leftJoin(resellerTiers, eq(resellerTiers.id, resellerAccounts.tierId))
                .where(where)
                .orderBy(desc(resellerAccounts.appliedAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db
                .select({ total: sql<number>`count(*)::int` })
                .from(resellerAccounts)
                .innerJoin(users, eq(users.id, resellerAccounts.userId))
                .where(where),
        ]);

        return {
            items: items.map((item) => ({
                ...item,
                multiplier: effectiveMultiplier({ status: item.status, multiplierOverride: item.multiplierOverride, tierMultiplier: item.tierMultiplier }),
            })),
            total: counted?.total ?? 0,
            page: query.page,
            pageSize: query.pageSize,
        };
    }

    async counts() {
        const rows = await this.db.select({ status: resellerAccounts.status, total: sql<number>`count(*)::int` }).from(resellerAccounts).groupBy(resellerAccounts.status);
        const byStatus = Object.fromEntries(rows.map((row) => [row.status, row.total]));
        return {
            pending: byStatus.pending ?? 0,
            approved: byStatus.approved ?? 0,
            rejected: byStatus.rejected ?? 0,
            suspended: byStatus.suspended ?? 0,
        };
    }

    /**
     * Approves or rejects an application. Approval promotes the user's role to `reseller` in the same
     * transaction as the account row, so the console guard and the billing coefficient can never
     * disagree about whether someone is a reseller.
     */
    async review(userId: string, reviewerId: string, input: ReviewResellerDto) {
        const account = await this.account(userId);
        if (account.status !== "pending") throw badRequest("APPLICATION_NOT_PENDING", "当前没有待审核的等级提升申请");

        if (input.decision === "reject") {
            const reason = input.rejectReason?.trim();
            if (!reason) throw badRequest("REJECT_REASON_REQUIRED", "驳回时必须填写原因");
            const [reviewed] = await this.db.update(resellerAccounts)
                .set({ status: "rejected", rejectReason: reason, reviewedAt: new Date(), reviewedBy: reviewerId, updatedAt: new Date() })
                .where(and(eq(resellerAccounts.userId, userId), eq(resellerAccounts.status, "pending")))
                .returning({ userId: resellerAccounts.userId });
            if (!reviewed) throw badRequest("APPLICATION_STATE_CHANGED", "申请状态已变化，请刷新后重试");
            // Rejection keeps access, the current tier, its override, and the user's role unchanged.
            await this.afterCoefficientChange(userId);
            return { status: "rejected" as const };
        }

        const tierId = input.tierId ?? (await this.defaultTierId());
        if (!tierId) throw badRequest("NO_TIER_CONFIGURED", "请先创建至少一个代理商等级");
        await this.tier(tierId);

        await this.db.transaction(async (tx) => {
            const [reviewed] = await tx.update(resellerAccounts)
                .set({ status: "approved", tierId, rejectReason: "", reviewedAt: new Date(), reviewedBy: reviewerId, updatedAt: new Date() })
                .where(and(eq(resellerAccounts.userId, userId), eq(resellerAccounts.status, "pending")))
                .returning({ userId: resellerAccounts.userId });
            if (!reviewed) throw badRequest("APPLICATION_STATE_CHANGED", "申请状态已变化，请刷新后重试");
            // An admin keeps their admin role; promotion only applies to plain users.
            await tx.update(users).set({ role: "reseller", updatedAt: new Date() }).where(and(eq(users.id, userId), eq(users.role, "user")));
        });
        await this.afterCoefficientChange(userId);
        return { status: "approved" as const, tierId };
    }

    async update(userId: string, input: UpdateResellerDto) {
        const account = await this.account(userId);
        if (input.tierId) await this.tier(input.tierId);
        if (input.multiplierOverride !== undefined) this.assertMultiplier(input.multiplierOverride);

        await this.db.transaction(async (tx) => {
            await tx
                .update(resellerAccounts)
                .set({
                    ...(input.tierId ? { tierId: input.tierId } : {}),
                    ...(input.clearMultiplierOverride ? { multiplierOverride: null } : input.multiplierOverride !== undefined ? { multiplierOverride: toMoneyString(input.multiplierOverride) } : {}),
                    ...(input.status ? { status: input.status } : {}),
                    updatedAt: new Date(),
                })
                .where(eq(resellerAccounts.userId, userId));

            if (input.status === "suspended") {
                await tx.update(users).set({ role: "user", updatedAt: new Date() }).where(and(eq(users.id, userId), eq(users.role, "reseller")));
            }
            if (input.status === "approved" && account.status === "suspended") {
                await tx.update(users).set({ role: "reseller", updatedAt: new Date() }).where(and(eq(users.id, userId), eq(users.role, "user")));
            }
        });
        await this.afterCoefficientChange(userId);
        return this.detail(userId);
    }

    async detail(userId: string) {
        const [row] = await this.db
            .select({
                userId: resellerAccounts.userId,
                username: users.username,
                status: resellerAccounts.status,
                tierId: resellerAccounts.tierId,
                tierName: resellerTiers.name,
                tierMultiplier: resellerTiers.multiplier,
                multiplierOverride: resellerAccounts.multiplierOverride,
                companyName: resellerAccounts.companyName,
                contactEmail: resellerAccounts.contactEmail,
                website: resellerAccounts.website,
                useCase: resellerAccounts.useCase,
                rejectReason: resellerAccounts.rejectReason,
                appliedAt: resellerAccounts.appliedAt,
                reviewedAt: resellerAccounts.reviewedAt,
            })
            .from(resellerAccounts)
            .innerJoin(users, eq(users.id, resellerAccounts.userId))
            .leftJoin(resellerTiers, eq(resellerTiers.id, resellerAccounts.tierId))
            .where(eq(resellerAccounts.userId, userId))
            .limit(1);
        if (!row) throw notFound("代理商不存在");
        return { ...row, multiplier: effectiveMultiplier({ status: row.status, multiplierOverride: row.multiplierOverride, tierMultiplier: row.tierMultiplier }) };
    }

    /** Both caches key on the user, and both feed pricing, so they are always cleared together. */
    private async afterCoefficientChange(userId: string) {
        await this.pricing.invalidate(userId);
        await this.keys.invalidateUser(userId);
    }

    private async invalidateTierKeys(tierId: string) {
        const rows = await this.db.select({ userId: resellerAccounts.userId }).from(resellerAccounts).where(eq(resellerAccounts.tierId, tierId));
        await Promise.all(rows.map((row) => this.keys.invalidateUser(row.userId)));
    }

    private async clearOtherDefaults(keepId: string) {
        await this.db.update(resellerTiers).set({ isDefault: false, updatedAt: new Date() }).where(and(eq(resellerTiers.isDefault, true), sql`${resellerTiers.id} <> ${keepId}`));
    }

    private async defaultTierId() {
        const [row] = await this.db.select({ id: resellerTiers.id }).from(resellerTiers).where(eq(resellerTiers.isDefault, true)).limit(1);
        if (row) return row.id;
        const [fallback] = await this.db.select({ id: resellerTiers.id }).from(resellerTiers).orderBy(asc(resellerTiers.sortOrder)).limit(1);
        return fallback?.id ?? null;
    }

    private async tier(id: string) {
        const [row] = await this.db.select().from(resellerTiers).where(eq(resellerTiers.id, id)).limit(1);
        if (!row) throw notFound("代理商等级不存在");
        return row;
    }

    private async account(userId: string) {
        const [row] = await this.db.select().from(resellerAccounts).where(eq(resellerAccounts.userId, userId)).limit(1);
        if (!row) throw notFound("入驻申请不存在");
        return row;
    }

    /** A surcharge at or below -1 would make generation free, so it is rejected outright. */
    private assertMultiplier(value: string) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) throw badRequest("INVALID_MULTIPLIER", "倍率必须是数字");
        if (parsed <= -1) throw badRequest("INVALID_MULTIPLIER", "倍率不能低于 -1，否则调用将免费或为负");
        if (parsed > 100) throw badRequest("INVALID_MULTIPLIER", "倍率过大，请确认填写的是加价幅度而不是倍数");
    }
}
