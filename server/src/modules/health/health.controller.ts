import { Controller, Get, Inject } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { sql } from "drizzle-orm";
import Redis from "ioredis";
import { collectDefaultMetrics, register } from "prom-client";
import { Public } from "../../common/decorators";
import { DB, type Database } from "../../db/db.module";
import { REDIS } from "../../redis/redis.module";

collectDefaultMetrics({ prefix: "infinite_canvas_" });

@ApiExcludeController()
@Controller()
export class HealthController {
    constructor(
        @Inject(DB) private readonly db: Database,
        @Inject(REDIS) private readonly redis: Redis,
    ) {}

    /** Liveness: answers as long as the process is up. Used by Docker's healthcheck. */
    @Public()
    @Get("health")
    health() {
        return { ok: true, uptime: Math.round(process.uptime()) };
    }

    /** Readiness: only true when both dependencies answer, so a rolling deploy waits for them. */
    @Public()
    @Get("ready")
    async ready() {
        const [database, redis] = await Promise.allSettled([this.db.execute(sql`select 1`), this.redis.ping()]);
        const ok = database.status === "fulfilled" && redis.status === "fulfilled";
        return { ok, database: database.status === "fulfilled", redis: redis.status === "fulfilled" };
    }

    @Get("metrics")
    async metrics() {
        return register.metrics();
    }
}
