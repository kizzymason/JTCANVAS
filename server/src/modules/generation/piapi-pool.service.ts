import { Inject, Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { and, asc, eq, gte, or, sql } from "drizzle-orm";
import Redis from "ioredis";
import { DB, type Database } from "../../db/db.module";
import { piapiAccounts } from "../../db/schema";
import { noUsableChannel } from "../../common/errors";
import { toMoneyString } from "../../common/money";
import { REDIS } from "../../redis/redis.module";
import { CryptoService } from "../crypto/crypto.service";

const PIAPI_BASE_URL = "https://api.piapi.ai";
/** Cheapest Seedream image; below this a key cannot produce anything, so it counts as exhausted. */
const MIN_BALANCE_USD = "0.052";
const MAX_ACCOUNT_ATTEMPTS = 5;
const CURSOR_KEY = "piapi:cursor";
const INSUFFICIENT_PATTERN = /insufficient|not enough|no available credit|credit|balance|quota|exceed/i;

export type PiapiAccount = typeof piapiAccounts.$inferSelect;

/**
 * Server-side PiAPI key pool. Ported from the browser implementation, but the rotation cursor now
 * lives in Redis so multiple workers spread across the pool instead of all starting at account 1.
 */
@Injectable()
export class PiapiPoolService {
    private readonly logger = new Logger(PiapiPoolService.name);

    constructor(
        @Inject(DB) private readonly db: Database,
        @Inject(REDIS) private readonly redis: Redis,
        private readonly crypto: CryptoService,
    ) {}

    /**
     * Runs `task` against pool accounts until one succeeds. An account that reports an empty balance or
     * a rejected key is parked and the next one is tried immediately, so switching stays invisible.
     */
    async runWithKey<T>(task: (apiKey: string, account: PiapiAccount) => Promise<T>): Promise<T> {
        const accounts = await this.eligible();
        if (!accounts.length) throw noUsableChannel("PiAPI 账号池没有可用账号，请在管理后台补充或刷新余额");

        const offset = await this.nextOffset(accounts.length);
        const ordered = [...accounts.slice(offset), ...accounts.slice(0, offset)].slice(0, MAX_ACCOUNT_ATTEMPTS);

        let lastError: unknown;
        for (const account of ordered) {
            const apiKey = this.crypto.decrypt(account.apiKeyCipher, account.apiKeyId);
            try {
                const result = await task(apiKey, account);
                await this.db
                    .update(piapiAccounts)
                    .set({ usedCount: sql`${piapiAccounts.usedCount} + 1`, lastError: "", updatedAt: new Date() })
                    .where(eq(piapiAccounts.id, account.id));
                // Refresh the real balance in the background so the next pick is accurate.
                void this.refreshBalance(account.id, apiKey).catch(() => undefined);
                return result;
            } catch (error) {
                const kind = classify(error);
                if (kind === "transient") throw error;
                lastError = error;
                await this.db
                    .update(piapiAccounts)
                    .set({
                        status: kind === "insufficient" ? "exhausted" : "invalid",
                        ...(kind === "insufficient" ? { balanceUsd: "0" } : {}),
                        lastError: describe(error).slice(0, 500),
                        checkedAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .where(eq(piapiAccounts.id, account.id));
                this.logger.warn(`PiAPI account ${account.id} parked as ${kind}`);
            }
        }
        throw noUsableChannel(`已尝试 ${ordered.length} 个 PiAPI 账号仍然失败：${describe(lastError)}`);
    }

    async refreshBalance(id: string, apiKey?: string) {
        const [account] = await this.db.select().from(piapiAccounts).where(eq(piapiAccounts.id, id)).limit(1);
        if (!account) return null;
        const key = apiKey ?? this.crypto.decrypt(account.apiKeyCipher, account.apiKeyId);
        try {
            const response = await axios.get<{ code?: number; data?: { name?: string; plan?: string; equivalent_in_usd?: number }; message?: string }>(`${PIAPI_BASE_URL}/account/info`, {
                headers: { "x-api-key": key },
            });
            const info = response.data?.data;
            if (!info) throw new Error(response.data?.message || "读取余额失败");
            const balance = toMoneyString(info.equivalent_in_usd ?? 0);
            await this.db
                .update(piapiAccounts)
                .set({
                    username: info.name || account.username,
                    balanceUsd: balance,
                    checkedAt: new Date(),
                    lastError: "",
                    // Only revive keys we previously parked; a manual pause stays paused.
                    status: account.status === "disabled" ? "disabled" : Number(balance) >= Number(MIN_BALANCE_USD) ? "active" : "exhausted",
                    metadata: { plan: info.plan ?? "" },
                    updatedAt: new Date(),
                })
                .where(eq(piapiAccounts.id, id));
            return balance;
        } catch (error) {
            const message = describe(error);
            await this.db
                .update(piapiAccounts)
                .set({ checkedAt: new Date(), lastError: message.slice(0, 500), ...(/(401|403)/.test(message) ? { status: "invalid" as const } : {}), updatedAt: new Date() })
                .where(eq(piapiAccounts.id, id));
            return null;
        }
    }

    async refreshAll() {
        const accounts = await this.db.select({ id: piapiAccounts.id }).from(piapiAccounts);
        await Promise.allSettled(accounts.map((account) => this.refreshBalance(account.id)));
        return accounts.length;
    }

    async importAccounts(rows: Array<{ username: string; apiKey: string }>) {
        const existing = await this.db.select({ apiKeyCipher: piapiAccounts.apiKeyCipher, apiKeyId: piapiAccounts.apiKeyId }).from(piapiAccounts);
        const seen = new Set(existing.map((row) => this.crypto.decrypt(row.apiKeyCipher, row.apiKeyId)));

        let added = 0;
        let skipped = 0;
        for (const row of rows) {
            const apiKey = row.apiKey.trim();
            if (!apiKey || seen.has(apiKey)) {
                skipped += 1;
                continue;
            }
            seen.add(apiKey);
            const { cipher, keyId } = this.crypto.encrypt(apiKey);
            await this.db.insert(piapiAccounts).values({
                username: row.username.trim(),
                apiKeyCipher: cipher,
                apiKeyId: keyId,
                apiKeyTail: CryptoService.tail(apiKey),
            });
            added += 1;
        }
        return { added, skipped };
    }

    private async eligible() {
        return this.db
            .select()
            .from(piapiAccounts)
            .where(
                and(
                    eq(piapiAccounts.status, "active"),
                    // An account never checked has balance 0; try it rather than hiding it forever.
                    or(sql`${piapiAccounts.checkedAt} is null`, gte(piapiAccounts.balanceUsd, MIN_BALANCE_USD)),
                ),
            )
            .orderBy(asc(piapiAccounts.createdAt));
    }

    private async nextOffset(size: number) {
        const cursor = await this.redis.incr(CURSOR_KEY);
        return ((cursor - 1) % size + size) % size;
    }
}

function classify(error: unknown): "insufficient" | "invalid" | "transient" {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    if (status === 402) return "insufficient";
    if (status === 401 || status === 403) return "invalid";
    // PiAPI does not document an insufficient-credit code, so fall back to matching the message.
    return INSUFFICIENT_PATTERN.test(describe(error)) ? "insufficient" : "transient";
}

function describe(error: unknown) {
    if (axios.isAxiosError(error)) {
        const data = error.response?.data as { message?: string; error?: { message?: string } } | undefined;
        return [error.response?.status, data?.message, data?.error?.message, error.message].filter(Boolean).join(" ");
    }
    return error instanceof Error ? error.message : String(error);
}
