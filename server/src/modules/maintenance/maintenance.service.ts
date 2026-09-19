import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { DB, type Database } from "../../db/db.module";
import { files, generationTasks, idempotencyKeys, sessions } from "../../db/schema";
import { MerchantCommissionService } from "../cards/merchant-commission.service";
import { MerchantWebhookService } from "../cards/merchant-webhook.service";
import { ApiKeyService } from "../openapi/api-key.service";
import { pruneApiRequestLogs } from "../openapi/usage-recorder.service";
import { pruneVisitorEvents } from "../visitors/visitors.service";
import { StorageService } from "../storage/storage.service";
import { WalletService } from "../wallet/wallet.service";

/** Housekeeping. Runs in the worker only, so multiple API instances cannot duplicate the work. */
@Injectable()
export class MaintenanceService {
    private readonly logger = new Logger(MaintenanceService.name);

    constructor(
        @Inject(DB) private readonly db: Database,
        private readonly config: ConfigService,
        private readonly storage: StorageService,
        private readonly wallet: WalletService,
        private readonly apiKeys: ApiKeyService,
        private readonly merchantCommission: MerchantCommissionService,
        private readonly merchantWebhooks: MerchantWebhookService,
    ) {}

    /** Deletes files nothing points at any more, one owner at a time. */
    @Cron(CronExpression.EVERY_HOUR)
    async collectOrphanFiles() {
        const owners = await this.db
            .selectDistinct({ ownerId: files.ownerId })
            .from(files)
            .where(and(eq(files.refCount, 0), isNull(files.deletedAt)))
            .limit(100);
        let total = 0;
        for (const owner of owners) total += await this.storage.collectOrphans(owner.ownerId);
        if (total) this.logger.log(`Orphan sweep removed ${total} files across ${owners.length} owners`);
    }

    /**
     * Releases funds for tasks that were frozen but never reached a terminal state, which can happen if
     * a worker is killed mid-flight. Without this a crash would silently hold a user's money.
     */
    @Cron(CronExpression.EVERY_10_MINUTES)
    async releaseStaleFreezes() {
        const cutoff = new Date(Date.now() - 60 * 60 * 1000);
        const stale = await this.db
            .select()
            .from(generationTasks)
            .where(and(eq(generationTasks.status, "running"), lt(generationTasks.startedAt, cutoff)))
            .limit(100);

        for (const task of stale) {
            await this.db
                .update(generationTasks)
                .set({ status: "failed", error: "任务超时未完成，已自动释放冻结金额", finishedAt: new Date(), updatedAt: new Date() })
                .where(eq(generationTasks.id, task.id));
            await this.wallet.release({ userId: task.userId, taskId: task.id, amount: task.estimatedCost, note: "任务超时自动退回" }).catch((error) => {
                this.logger.error(`Failed to release stale freeze for ${task.id}: ${String(error)}`);
            });
            const params = task.params as Record<string, unknown>;
            const apiKeyId = typeof params.apiKeyId === "string" ? params.apiKeyId : "";
            if (task.source === "openapi" && apiKeyId) {
                await this.apiKeys.settleUsageReservation(apiKeyId, task.estimatedCost, "0").catch((error) => {
                    this.logger.error(`Failed to release stale API-key quota for ${task.id}: ${String(error)}`);
                });
            }
        }
        if (stale.length) this.logger.warn(`Released ${stale.length} stale freezes`);
    }

    /** Reports wallets whose ledger no longer adds up. Never auto-corrects; a mismatch needs a human. */
    @Cron(CronExpression.EVERY_DAY_AT_4AM)
    async reconcile() {
        const mismatches = await this.wallet.reconcileAll();
        if (mismatches.length) this.logger.error(`Wallet reconciliation found ${mismatches.length} mismatches: ${JSON.stringify(mismatches.slice(0, 10))}`);
        else this.logger.log("Wallet reconciliation clean");

        // Channel commission follows the same invariant: the ledger must sum to the balance.
        const commissionMismatches = await this.merchantCommission.reconcileAll();
        if (commissionMismatches.length) {
            this.logger.error(`Channel commission reconciliation found ${commissionMismatches.length} mismatches: ${JSON.stringify(commissionMismatches.slice(0, 10))}`);
        } else {
            this.logger.log("Channel commission reconciliation clean");
        }
    }

    /**
     * Cuts off sales channels whose refunds are running hot. Runs here rather than on the sales path
     * because it is a rolling judgement over 30 days, and because the account it protects is ours.
     */
    @Cron(CronExpression.EVERY_HOUR)
    async guardChannelRefundRate() {
        await this.merchantWebhooks.enforceRefundGuard();
    }

    /** Expired sessions and consumed idempotency keys have no value after a day. */
    @Cron(CronExpression.EVERY_DAY_AT_3AM)
    async pruneEphemeral() {
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        await this.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
        await this.db.delete(idempotencyKeys).where(and(lt(idempotencyKeys.createdAt, dayAgo), sql`${idempotencyKeys.responseBody} is not null`));
        await pruneVisitorEvents(this.db);
        await pruneApiRequestLogs(this.db, this.config.get<number>("openPlatform.logRetentionDays") ?? 90);
    }
}
