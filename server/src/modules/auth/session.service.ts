import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, eq, isNull } from "drizzle-orm";
import Redis from "ioredis";
import { DB, type Database } from "../../db/db.module";
import { sessions, users } from "../../db/schema";
import { REDIS } from "../../redis/redis.module";
import type { AuthUser, UserRole } from "../../common/types";

const SESSION_PREFIX = "session:";
const USER_SESSIONS_PREFIX = "user-sessions:";

type SessionPayload = { userId: string; username: string; role: UserRole };

/**
 * Opaque random tokens in Redis rather than JWTs: a ban or a password change has to invalidate
 * existing sessions immediately, which a self-contained signed token cannot do.
 */
@Injectable()
export class SessionService {
    private readonly ttlSeconds: number;

    constructor(
        @Inject(DB) private readonly db: Database,
        @Inject(REDIS) private readonly redis: Redis,
        config: ConfigService,
    ) {
        this.ttlSeconds = config.get<number>("session.ttlSeconds")!;
    }

    async create(payload: SessionPayload, context: { ip: string; userAgent: string }) {
        const id = randomBytes(32).toString("base64url");
        await this.redis
            .multi()
            .set(SESSION_PREFIX + id, JSON.stringify(payload), "EX", this.ttlSeconds)
            // Index by user so a ban can drop every session the user holds.
            .sadd(USER_SESSIONS_PREFIX + payload.userId, id)
            .expire(USER_SESSIONS_PREFIX + payload.userId, this.ttlSeconds)
            .exec();

        await this.db.insert(sessions).values({
            id,
            userId: payload.userId,
            ip: context.ip,
            userAgent: context.userAgent.slice(0, 512),
            expiresAt: new Date(Date.now() + this.ttlSeconds * 1000),
        });
        return id;
    }

    /** Reads the session and slides its expiry, so an active user is not logged out mid-session. */
    async resolve(id: string): Promise<AuthUser | null> {
        if (!id) return null;
        const raw = await this.redis.get(SESSION_PREFIX + id);
        if (!raw) return null;
        const payload = JSON.parse(raw) as SessionPayload;
        // Role and status are authoritative in Postgres: an admin promotion or a ban must take
        // effect on the next request without waiting for the Redis payload to be rewritten.
        const [user] = await this.db.select({ username: users.username, role: users.role, status: users.status }).from(users).where(eq(users.id, payload.userId)).limit(1);
        if (!user || user.status === "disabled") {
            await this.revoke(id, payload.userId);
            return null;
        }
        if (user.role !== payload.role || user.username !== payload.username) {
            await this.redis.set(SESSION_PREFIX + id, JSON.stringify({ userId: payload.userId, username: user.username, role: user.role } satisfies SessionPayload), "KEEPTTL");
        }
        await this.redis.expire(SESSION_PREFIX + id, this.ttlSeconds);
        return { id: payload.userId, username: user.username, role: user.role, sessionId: id };
    }

    async revoke(id: string, userId?: string) {
        await this.redis.del(SESSION_PREFIX + id);
        if (userId) await this.redis.srem(USER_SESSIONS_PREFIX + userId, id);
        await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
    }

    /** Used when an admin disables an account or a user changes their password. */
    async revokeAllForUser(userId: string) {
        const ids = await this.redis.smembers(USER_SESSIONS_PREFIX + userId);
        if (ids.length) await this.redis.del(...ids.map((id) => SESSION_PREFIX + id));
        await this.redis.del(USER_SESSIONS_PREFIX + userId);
        await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    }

    /** Keeps a live session's cached role in step with an admin role change. */
    async refreshPayload(userId: string, payload: SessionPayload) {
        const ids = await this.redis.smembers(USER_SESSIONS_PREFIX + userId);
        if (!ids.length) return;
        const pipeline = this.redis.multi();
        for (const id of ids) pipeline.set(SESSION_PREFIX + id, JSON.stringify(payload), "KEEPTTL");
        await pipeline.exec();
    }
}
