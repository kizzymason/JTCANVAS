import { hash, verify } from "@node-rs/argon2";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, gt, sql } from "drizzle-orm";
import Redis from "ioredis";
import { DB, type Database } from "../../db/db.module";
import { registrationLocks, users, wallets } from "../../db/schema";
import { badRequest, conflict, forbidden, tooManyRequests, unauthorized } from "../../common/errors";
import { toMoneyString } from "../../common/money";
import type { AuthUser } from "../../common/types";
import { REDIS } from "../../redis/redis.module";
import { SettingsService } from "../settings/settings.service";
import { WalletService } from "../wallet/wallet.service";
import { IP_REGISTER_WINDOW_MS, REGISTER_HOURLY_LIMIT, REGISTER_HOURLY_WINDOW_SECONDS, registrationLockError } from "./registration-policy";
import { SessionService } from "./session.service";
import { SliderChallengeService } from "./slider-challenge.service";

/** OWASP-recommended argon2id parameters: 19 MiB, 2 iterations, 1 lane. */
const ARGON_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        @Inject(DB) private readonly db: Database,
        @Inject(REDIS) private readonly redis: Redis,
        private readonly sessions: SessionService,
        private readonly settings: SettingsService,
        private readonly wallet: WalletService,
        private readonly slider: SliderChallengeService,
    ) {}

    async register(
        input: { username: string; password: string; sliderToken: string; fingerprint: string; website?: string },
        context: { ip: string; userAgent: string },
    ) {
        if (input.website?.trim()) throw badRequest("REGISTER_REJECTED", "注册失败");

        const site = await this.settings.getSite();
        if (!site.registrationEnabled) throw forbidden("当前站点已关闭注册");

        await this.slider.consume(input.sliderToken);
        await this.enforceHourlyIp(context.ip);

        const username = input.username.trim();
        const fingerprint = input.fingerprint.trim().toLowerCase();
        const passwordHash = await hash(input.password, ARGON_OPTIONS);

        const user = await this.db.transaction(async (tx) => {
            // Serialize first-user detection so two concurrent registrations cannot both become admin.
            await tx.execute(sql.raw("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE"));
            const existing = await tx.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
            if (existing.length) throw conflict("USERNAME_TAKEN", "该用户名已被注册");

            // The very first account becomes the administrator, so a fresh deployment is usable without a seed script.
            const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(users);
            const isFirstUser = total === 0;
            const role = isFirstUser ? "admin" : "user";

            if (!isFirstUser) {
                const [lock] = await tx.select().from(registrationLocks).where(eq(registrationLocks.fingerprintHash, fingerprint)).limit(1);
                const since = new Date(Date.now() - IP_REGISTER_WINDOW_MS);
                const [{ ipCount }] = await tx
                    .select({ ipCount: sql<number>`count(*)::int` })
                    .from(registrationLocks)
                    .where(and(eq(registrationLocks.ip, context.ip), gt(registrationLocks.registeredAt, since)));
                const blocked = registrationLockError({
                    isFirstUser,
                    lockRegisteredAt: lock?.registeredAt ?? null,
                    ipSuccessCount: ipCount ?? 0,
                });
                if (blocked) {
                    if (blocked.code === "DEVICE_REGISTERED") throw conflict(blocked.code, blocked.message);
                    throw tooManyRequests(blocked.message);
                }
            }

            const [created] = await tx.insert(users).values({ username, passwordHash, role }).returning();
            await tx.insert(wallets).values({ userId: created.id });
            await tx
                .insert(registrationLocks)
                .values({ fingerprintHash: fingerprint, ip: context.ip, userId: created.id, registeredAt: new Date() })
                .onConflictDoUpdate({
                    target: registrationLocks.fingerprintHash,
                    set: { ip: context.ip, userId: created.id, registeredAt: new Date() },
                });
            return created;
        });

        // Gift balance is a separate, audited ledger entry rather than an initial balance value.
        const gift = toMoneyString(site.newUserGiftAmount || 0);
        if (Number.parseFloat(gift) > 0) {
            await this.wallet.credit({ userId: user.id, amount: gift, type: "admin_adjust", note: "新用户注册赠送", paymentProvider: "admin" });
            this.logger.log(`Granted registration gift ${gift} to ${username}`);
        }

        const sessionId = await this.sessions.create({ userId: user.id, username: user.username, role: user.role }, context);
        return { sessionId, user: this.toAuthUser(user, sessionId) };
    }

    async login(input: { username: string; password: string }, context: { ip: string; userAgent: string }) {
        const [user] = await this.db.select().from(users).where(eq(users.username, input.username.trim())).limit(1);
        // Same error for unknown user and wrong password so the endpoint cannot be used to enumerate accounts.
        if (!user) throw unauthorized("用户名或密码不正确");
        if (!(await verify(user.passwordHash, input.password))) throw unauthorized("用户名或密码不正确");
        if (user.status === "disabled") throw forbidden("该账号已被禁用，请联系管理员");

        await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
        const sessionId = await this.sessions.create({ userId: user.id, username: user.username, role: user.role }, context);
        return { sessionId, user: this.toAuthUser(user, sessionId) };
    }

    async changePassword(userId: string, input: { currentPassword: string; newPassword: string }) {
        const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) throw unauthorized();
        if (!(await verify(user.passwordHash, input.currentPassword))) throw badRequest("WRONG_PASSWORD", "当前密码不正确");

        await this.db.update(users).set({ passwordHash: await hash(input.newPassword, ARGON_OPTIONS), updatedAt: new Date() }).where(eq(users.id, userId));
        // Force every device to sign in again with the new password.
        await this.sessions.revokeAllForUser(userId);
    }

    logout(user: AuthUser) {
        return this.sessions.revoke(user.sessionId, user.id);
    }

    static hashPassword(password: string) {
        return hash(password, ARGON_OPTIONS);
    }

    private async enforceHourlyIp(ip: string) {
        const key = `register:hour:${ip || "unknown"}`;
        const count = await this.redis.incr(key);
        if (count === 1) await this.redis.expire(key, REGISTER_HOURLY_WINDOW_SECONDS);
        if (count > REGISTER_HOURLY_LIMIT) throw tooManyRequests("请稍后再试");
    }

    private toAuthUser(user: typeof users.$inferSelect, sessionId: string): AuthUser {
        return { id: user.id, username: user.username, role: user.role, sessionId };
    }
}
