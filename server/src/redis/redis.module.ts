import { Global, Inject, Module, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

export const REDIS = Symbol("REDIS");
/** A second connection: a client in subscribe mode cannot run normal commands. */
export const REDIS_SUBSCRIBER = Symbol("REDIS_SUBSCRIBER");

function client(url: string) {
    return new Redis(url, {
        maxRetriesPerRequest: null, // Required by BullMQ, and avoids dropping commands during a failover.
        enableReadyCheck: true,
        lazyConnect: false,
    });
}

@Global()
@Module({
    providers: [
        { provide: REDIS, inject: [ConfigService], useFactory: (config: ConfigService) => client(config.get<string>("redis.url")!) },
        { provide: REDIS_SUBSCRIBER, inject: [ConfigService], useFactory: (config: ConfigService) => client(config.get<string>("redis.url")!) },
    ],
    exports: [REDIS, REDIS_SUBSCRIBER],
})
export class RedisModule implements OnApplicationShutdown {
    constructor(
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
    ) {}

    async onApplicationShutdown() {
        await Promise.allSettled([this.redis.quit(), this.subscriber.quit()]);
    }
}
