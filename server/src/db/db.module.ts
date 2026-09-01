import { Global, Inject, Module, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export const DB = Symbol("DB");
export const PG_CLIENT = Symbol("PG_CLIENT");

export type Database = ReturnType<typeof drizzle<typeof schema>>;
/** A transaction handle. Every wallet mutation must run inside one of these. */
export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createPgClient(url: string, poolMax = 10) {
    return postgres(url, {
        max: poolMax,
        // NUMERIC must arrive as a string; letting postgres.js parse it into a float would corrupt money.
        types: {
            numeric: {
                to: 1700,
                from: [1700],
                serialize: (value: string) => value,
                parse: (value: string) => value,
            },
        },
    });
}

@Global()
@Module({
    providers: [
        {
            provide: PG_CLIENT,
            inject: [ConfigService],
            useFactory: (config: ConfigService) => createPgClient(config.get<string>("database.url")!, config.get<number>("database.poolMax")),
        },
        {
            provide: DB,
            inject: [PG_CLIENT],
            useFactory: (client: postgres.Sql) => drizzle(client, { schema }),
        },
    ],
    exports: [DB, PG_CLIENT],
})
export class DbModule implements OnApplicationShutdown {
    constructor(@Inject(PG_CLIENT) private readonly client: postgres.Sql) {}

    async onApplicationShutdown() {
        // postgres.js keeps the event loop alive; close it so the container exits promptly.
        await this.client.end({ timeout: 5 });
    }
}
