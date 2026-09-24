import { scaleTokenPrices } from "../pricing/token-pricing";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { DB, type Database } from "../../db/db.module";
import { apiKeys, apiRequestLogs, apiUsageDaily, resellerAccounts, resellerTiers, users } from "../../db/schema";
import { badRequest, forbidden } from "../../common/errors";
import { toMoneyString } from "../../common/money";
import type { Paginated } from "../../common/types";
import { PricingService } from "../pricing/pricing.service";
import { applyMultiplier, effectiveMultiplier, NEUTRAL_MULTIPLIER } from "../pricing/reseller-multiplier";
import { ResellerPricingService } from "../pricing/reseller-pricing.service";
import { WalletService } from "../wallet/wallet.service";
import { utcDateString } from "../visitors/visitors-classify";
import { UsageRecorderService } from "../openapi/usage-recorder.service";
import type { ApplyResellerDto, ResellerLogQueryDto } from "./dto/reseller.dto";
import { hasOpenPlatformAccess } from "./reseller-access";

export type ResellerStatusView = {
    status: "none" | "pending" | "approved" | "rejected" | "suspended";
    /** Basic access remains available unless explicitly suspended. */
    canUseConsole: boolean;
    tierName: string | null;
    /** Signed surcharge, matching how the admin configures it. */
    surcharge: string;
    /** Coefficient actually used in billing, i.e. 1 + surcharge. */
    multiplier: string;
    rejectReason: string;
    appliedAt: Date | null;
    reviewedAt: Date | null;
    profile: {
        companyName: string;
        contactEmail: string;
        website: string;
        useCase: string;
    } | null;
};

/**
 * Everything the reseller console reads. Aggregates come from `api_usage_daily` rather than the raw
 * log table so the dashboard stays a handful of indexed lookups no matter how much traffic a
 * reseller pushes.
 */
@Injectable()
export class ResellerService {
    constructor(
        @Inject(DB) private readonly db: Database,
        private readonly pricing: PricingService,
        private readonly resellerPricing: ResellerPricingService,
        private readonly wallet: WalletService,
        private readonly usage: UsageRecorderService,
    ) {}

    /** Requests a better reseller tier. Basic access is created automatically at the public price. */
    async apply(userId: string, input: ApplyResellerDto) {
        const existing = await this.ensureEnrolled(userId);
        if (existing?.status === "pending") throw badRequest("APPLICATION_PENDING", "等级提升申请正在审核中");
        if (existing?.status === "suspended") throw forbidden("代理商资格已被暂停，请联系平台管理员");

        const values = {
            companyName: input.companyName.trim(),
            contactEmail: input.contactEmail?.trim() ?? "",
            website: input.website?.trim() ?? "",
            useCase: input.useCase.trim(),
        };

        const [submitted] = await this.db.update(resellerAccounts)
            .set({ ...values, status: "pending", rejectReason: "", appliedAt: new Date(), reviewedAt: null, reviewedBy: null, updatedAt: new Date() })
            .where(and(eq(resellerAccounts.userId, userId), inArray(resellerAccounts.status, ["approved", "rejected"])))
            .returning({ userId: resellerAccounts.userId });
        if (!submitted) throw badRequest("APPLICATION_STATE_CHANGED", "申请状态已变化，请刷新后重试");
        await this.resellerPricing.invalidate(userId);
        return this.status(userId);
    }

    /** Updates the information used for a tier review without changing access by itself. */
    async updateProfile(userId: string, input: ApplyResellerDto, role?: string) {
        const account = await this.assertAccess(userId, role);
        if (!account) throw badRequest("NO_RESELLER_PROFILE", "当前账号没有入驻资料可维护");
        await this.db
            .update(resellerAccounts)
            .set({
                companyName: input.companyName.trim(),
                contactEmail: input.contactEmail?.trim() ?? "",
                website: input.website?.trim() ?? "",
                useCase: input.useCase.trim(),
                updatedAt: new Date(),
            })
            .where(eq(resellerAccounts.userId, userId));
        return this.profile(userId, role);
    }

    async status(userId: string, role?: string): Promise<ResellerStatusView> {
        const row = await this.ensureEnrolled(userId);
        if (!row) {
            return {
                status: "none",
                canUseConsole: true,
                tierName: null,
                surcharge: toMoneyString(0),
                multiplier: NEUTRAL_MULTIPLIER,
                rejectReason: "",
                appliedAt: null,
                reviewedAt: null,
                profile: null,
            };
        }

        const surcharge = row.multiplierOverride ?? row.tierMultiplier ?? toMoneyString(0);
        return {
            status: row.status,
            canUseConsole: hasOpenPlatformAccess(row.status),
            tierName: row.tierName ?? null,
            surcharge: toMoneyString(surcharge),
            multiplier: effectiveMultiplier({ status: row.status, multiplierOverride: row.multiplierOverride, tierMultiplier: row.tierMultiplier }),
            rejectReason: row.rejectReason,
            appliedAt: row.appliedAt,
            reviewedAt: row.reviewedAt,
            profile: {
                companyName: row.companyName,
                contactEmail: row.contactEmail,
                website: row.website,
                useCase: row.useCase,
            },
        };
    }

    /** Public catalogue with the reseller's own coefficient already folded into every price. */
    async models(userId: string) {
        const [all, multiplier] = await Promise.all([this.pricing.listPublicModels(), this.resellerPricing.multiplierFor(userId)]);
        return {
            multiplier,
            models: all.map((model) => ({
                id: model.modelName,
                qualifiedId: model.value,
                displayName: model.displayName,
                capability: model.capability,
                billingMode: model.billingMode,
                unitPrice: toMoneyString(applyMultiplier(model.unitPrice, multiplier)),
                listUnitPrice: model.unitPrice,
                minCharge: toMoneyString(applyMultiplier(model.minCharge, multiplier)),
                extraReferencePrice: toMoneyString(applyMultiplier(model.extraReferencePrice, multiplier)),
                specPrices: Object.fromEntries(Object.entries(model.specPrices).map(([spec, price]) => [spec, toMoneyString(applyMultiplier(price, multiplier))])),
                tokenPrices: scaleTokenPrices(model.tokenPrices, multiplier),
                features: model.features,
            })),
        };
    }

    async logs(userId: string, query: ResellerLogQueryDto): Promise<Paginated<Record<string, unknown>>> {
        const filters = [eq(apiRequestLogs.userId, userId)];
        if (query.from) filters.push(gte(apiRequestLogs.createdAt, new Date(query.from)));
        if (query.to) filters.push(lte(apiRequestLogs.createdAt, new Date(query.to)));
        if (query.model) filters.push(eq(apiRequestLogs.model, query.model));
        if (query.apiKeyId) filters.push(eq(apiRequestLogs.apiKeyId, query.apiKeyId));
        if (query.status) filters.push(eq(apiRequestLogs.status, query.status));
        const where = and(...filters);

        const [items, [counted]] = await Promise.all([
            this.db
                .select({
                    id: apiRequestLogs.id,
                    createdAt: apiRequestLogs.createdAt,
                    endpoint: apiRequestLogs.endpoint,
                    capability: apiRequestLogs.capability,
                    model: apiRequestLogs.model,
                    status: apiRequestLogs.status,
                    httpStatus: apiRequestLogs.httpStatus,
                    errorCode: apiRequestLogs.errorCode,
                    quantity: apiRequestLogs.quantity,
                    inputTokens: apiRequestLogs.inputTokens,
                    outputTokens: apiRequestLogs.outputTokens,
                    billedAmount: apiRequestLogs.billedAmount,
                    multiplier: apiRequestLogs.multiplier,
                    latencyMs: apiRequestLogs.latencyMs,
                    clientIp: apiRequestLogs.clientIp,
                    taskId: apiRequestLogs.taskId,
                    apiKeyId: apiRequestLogs.apiKeyId,
                    apiKeyName: apiKeys.name,
                })
                .from(apiRequestLogs)
                .leftJoin(apiKeys, eq(apiKeys.id, apiRequestLogs.apiKeyId))
                .where(where)
                .orderBy(desc(apiRequestLogs.createdAt))
                .limit(query.pageSize)
                .offset((query.page - 1) * query.pageSize),
            this.db.select({ total: sql<number>`count(*)::int` }).from(apiRequestLogs).where(where),
        ]);
        return { items, total: counted?.total ?? 0, page: query.page, pageSize: query.pageSize };
    }

    /**
     * Dashboard payload. Today and yesterday come from the daily rollup; the activity feed and the
     * model breakdown read the raw log, bounded by an indexed time range.
     */
    async overview(userId: string, days = 1) {
        const today = dayKey(0);
        const yesterday = dayKey(-1);
        const since = startOfDayUtc(-(Math.max(1, days) - 1));

        const [daily, keyCounts, activeToday, activeYesterday, recent, distribution, throughput, walletSnapshot] = await Promise.all([
            this.db
                .select()
                .from(apiUsageDaily)
                .where(and(eq(apiUsageDaily.userId, userId), inArray(apiUsageDaily.statDate, [today, yesterday]))),
            this.db
                .select({ total: sql<number>`count(*)::int`, active: sql<number>`count(*) filter (where ${apiKeys.status} = 'active')::int` })
                .from(apiKeys)
                .where(eq(apiKeys.userId, userId)),
            this.distinctKeysSince(userId, startOfDayUtc(0), null),
            this.distinctKeysSince(userId, startOfDayUtc(-1), startOfDayUtc(0)),
            this.db
                .select({
                    id: apiRequestLogs.id,
                    createdAt: apiRequestLogs.createdAt,
                    capability: apiRequestLogs.capability,
                    model: apiRequestLogs.model,
                    status: apiRequestLogs.status,
                    inputTokens: apiRequestLogs.inputTokens,
                    outputTokens: apiRequestLogs.outputTokens,
                    billedAmount: apiRequestLogs.billedAmount,
                })
                .from(apiRequestLogs)
                .where(eq(apiRequestLogs.userId, userId))
                .orderBy(desc(apiRequestLogs.createdAt))
                .limit(10),
            this.db
                .select({
                    model: apiRequestLogs.model,
                    requests: sql<number>`count(*)::int`,
                    tokens: sql<number>`coalesce(sum(${apiRequestLogs.inputTokens} + ${apiRequestLogs.outputTokens}), 0)::int`,
                    amount: sql<string>`coalesce(sum(${apiRequestLogs.billedAmount}), 0)::text`,
                })
                .from(apiRequestLogs)
                .where(and(eq(apiRequestLogs.userId, userId), gte(apiRequestLogs.createdAt, since)))
                .groupBy(apiRequestLogs.model)
                .orderBy(desc(sql`coalesce(sum(${apiRequestLogs.billedAmount}), 0)`))
                .limit(12),
            this.usage.realtime(userId),
            this.wallet.get(userId),
        ]);

        const todayRow = daily.find((row) => row.statDate === today);
        const yesterdayRow = daily.find((row) => row.statDate === yesterday);

        return {
            today: summariseDay(todayRow),
            yesterday: summariseDay(yesterdayRow),
            tokens: { total: keyCounts[0]?.total ?? 0, active: keyCounts[0]?.active ?? 0, activeToday, activeYesterday },
            throughput,
            balance: walletSnapshot.balance,
            recent,
            distribution: distribution.filter((row) => row.model),
            distributionDays: Math.max(1, days),
        };
    }

    realtime(userId: string) {
        return this.usage.realtime(userId);
    }

    /** Personal centre: tier, coefficient, wallet, and lifetime API spend. */
    async profile(userId: string, role?: string) {
        const [status, walletSnapshot, [account], [spend]] = await Promise.all([
            this.status(userId, role),
            this.wallet.get(userId),
            this.db.select({ username: users.username, createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1),
            this.db
                .select({
                    requests: sql<number>`coalesce(sum(${apiUsageDaily.requests}), 0)::int`,
                    inputTokens: sql<number>`coalesce(sum(${apiUsageDaily.inputTokens}), 0)::int`,
                    outputTokens: sql<number>`coalesce(sum(${apiUsageDaily.outputTokens}), 0)::int`,
                    billedAmount: sql<string>`coalesce(sum(${apiUsageDaily.billedAmount}), 0)::text`,
                })
                .from(apiUsageDaily)
                .where(eq(apiUsageDaily.userId, userId)),
        ]);

        return {
            ...status,
            username: account?.username ?? "",
            joinedAt: account?.createdAt ?? null,
            wallet: walletSnapshot,
            lifetime: {
                requests: spend?.requests ?? 0,
                inputTokens: spend?.inputTokens ?? 0,
                outputTokens: spend?.outputTokens ?? 0,
                billedAmount: toMoneyString(spend?.billedAmount ?? 0),
            },
        };
    }

    /** Enrollment and tier review do not grant an exception to explicit suspension. */
    async assertAccess(userId: string, role?: string) {
        const row = await this.ensureEnrolled(userId);
        if (!row || !hasOpenPlatformAccess(row.status)) throw forbidden("开放平台权限已停用，请联系平台管理员");
        return row;
    }

    /** Creates the zero-discount account on first access, without requiring an application. */
    private async ensureEnrolled(userId: string) {
        const existing = await this.accountFor(userId);
        if (existing) return existing;
        await this.db
            .insert(resellerAccounts)
            // No tier means public price even if an administrator changes the default review tier.
            .values({ userId, status: "approved", tierId: null, multiplierOverride: null })
            .onConflictDoNothing({ target: resellerAccounts.userId });
        return this.accountFor(userId);
    }

    private async distinctKeysSince(userId: string, from: Date, to: Date | null) {
        const filters = [eq(apiRequestLogs.userId, userId), gte(apiRequestLogs.createdAt, from)];
        if (to) filters.push(lt(apiRequestLogs.createdAt, to));
        const [row] = await this.db
            .select({ total: sql<number>`count(distinct ${apiRequestLogs.apiKeyId})::int` })
            .from(apiRequestLogs)
            .where(and(...filters));
        return row?.total ?? 0;
    }

    private async accountFor(userId: string) {
        const [row] = await this.db
            .select({
                userId: resellerAccounts.userId,
                status: resellerAccounts.status,
                multiplierOverride: resellerAccounts.multiplierOverride,
                tierId: resellerAccounts.tierId,
                tierName: resellerTiers.name,
                tierMultiplier: resellerTiers.multiplier,
                companyName: resellerAccounts.companyName,
                contactEmail: resellerAccounts.contactEmail,
                website: resellerAccounts.website,
                useCase: resellerAccounts.useCase,
                rejectReason: resellerAccounts.rejectReason,
                appliedAt: resellerAccounts.appliedAt,
                reviewedAt: resellerAccounts.reviewedAt,
            })
            .from(resellerAccounts)
            .leftJoin(resellerTiers, eq(resellerTiers.id, resellerAccounts.tierId))
            .where(eq(resellerAccounts.userId, userId))
            .limit(1);
        return row ?? null;
    }
}

function summariseDay(row: typeof apiUsageDaily.$inferSelect | undefined) {
    const inputTokens = row?.inputTokens ?? 0;
    const outputTokens = row?.outputTokens ?? 0;
    return {
        requests: row?.requests ?? 0,
        failedRequests: row?.failedRequests ?? 0,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        billedAmount: toMoneyString(row?.billedAmount ?? 0),
    };
}

/** UTC day keys, matching `api_usage_daily` and the existing visitor analytics. */
function dayKey(offsetDays: number) {
    return utcDateString(startOfDayUtc(offsetDays));
}

function startOfDayUtc(offsetDays: number) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
}
