import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { ConfigService } from "@nestjs/config";
import { drizzle } from "drizzle-orm/postgres-js";
import Redis from "ioredis";
import { createPgClient } from "../db/db.module";
import * as schema from "../db/schema";
import { CryptoService } from "../modules/crypto/crypto.service";
import { seedPiapiChannel } from "../modules/generation/piapi-channel.seed";
import { PiapiPoolService } from "../modules/generation/piapi-pool.service";

loadEnv({ path: resolve(__dirname, "../../.env") });

const DEFAULT_CSV = resolve(__dirname, "../../../piapi/piapi_accounts_2026-08-30T07-23-25.csv");
const USERNAME_HEADERS = ["username", "user", "email", "account", "用户名", "账号"];
const API_KEY_HEADERS = ["api key", "apikey", "api_key", "key", "密钥"];

/**
 * One-shot restore of the PiAPI channel and the registrar CSV into the live pool.
 * Does not run on API boot — re-running is safe: duplicate keys are skipped, prices are not overwritten.
 *
 * Usage: npx tsx src/scripts/import-piapi-csv.ts [path-to-csv]
 */
async function main() {
    const databaseUrl = process.env.DATABASE_URL;
    const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6389";
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    if (!process.env.APP_ENCRYPTION_KEY) throw new Error("APP_ENCRYPTION_KEY is required");

    const csvPath = resolve(process.argv[2] || DEFAULT_CSV);
    const accounts = parsePiapiCsv(await readFile(csvPath, "utf8"));
    if (!accounts.length) throw new Error(`No API keys found in ${csvPath}`);

    const client = createPgClient(databaseUrl, 1);
    const db = drizzle(client, { schema });
    const redis = new Redis(redisUrl);
    const crypto = new CryptoService({
        get: (key: string) => {
            if (key === "encryption.key") return process.env.APP_ENCRYPTION_KEY;
            if (key === "encryption.keyId") return process.env.APP_ENCRYPTION_KEY_ID || "k1";
            return undefined;
        },
    } as ConfigService);
    const pool = new PiapiPoolService(db, redis, crypto);

    try {
        const channel = await seedPiapiChannel(db);
        await redis.del("pricing:models");
        console.log(
            `PiAPI channel ${channel.created ? "created" : "ensured"} ${channel.id} modelsCreated=${channel.modelsCreated} pricesInserted=${channel.pricesInserted}`,
        );

        const imported = await pool.importAccounts(accounts);
        console.log(`Imported ${imported.added} accounts, skipped ${imported.skipped}`);

        const refreshed = await pool.refreshAll();
        console.log(`Refreshed ${refreshed} account balances`);
    } finally {
        redis.disconnect();
        await client.end({ timeout: 5 });
    }
}

function parsePiapiCsv(text: string) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) return [];
    const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
    const usernameIndex = headers.findIndex((header) => USERNAME_HEADERS.includes(header));
    const keyIndex = headers.findIndex((header) => API_KEY_HEADERS.includes(header));
    if (keyIndex < 0) throw new Error("CSV is missing an API Key column");

    const accounts: Array<{ username: string; apiKey: string }> = [];
    const seen = new Set<string>();
    for (const line of lines.slice(1)) {
        const cells = splitCsvLine(line);
        const apiKey = (cells[keyIndex] || "").trim();
        if (!apiKey || seen.has(apiKey)) continue;
        seen.add(apiKey);
        accounts.push({ username: usernameIndex >= 0 ? (cells[usernameIndex] || "").trim() : "", apiKey });
    }
    return accounts;
}

function splitCsvLine(line: string) {
    const out: string[] = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '"') {
            if (quoted && line[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                quoted = !quoted;
            }
        } else if (char === "," && !quoted) {
            out.push(current);
            current = "";
        } else {
            current += char;
        }
    }
    out.push(current);
    return out;
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
