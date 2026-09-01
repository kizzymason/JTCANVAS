import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgClient, type Database } from "../../db/db.module";
import * as schema from "../../db/schema";
import { orders, paymentChannels, users, wallets } from "../../db/schema";
import { toMoneyString } from "../../common/money";
import { CryptoService } from "../crypto/crypto.service";
import { WalletService } from "../wallet/wallet.service";
import { EpayAdapter } from "./epay.adapter";
import { epaySign } from "./epay.sign";
import { PaymentGatewayRegistry } from "./payment-gateway.registry";
import { PaymentsService } from "./payments.service";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://infinite:infinite@127.0.0.1:5442/infinite_canvas";
const TEST_KEY = "a".repeat(64);

let client: postgres.Sql;
let db: Database;
let wallet: WalletService;
let payments: PaymentsService;
let crypto: CryptoService;

async function createUser() {
    const username = `pay_${randomUUID().slice(0, 12)}`;
    const [user] = await db.insert(users).values({ username, passwordHash: "x" }).returning();
    await db.insert(wallets).values({ userId: user.id });
    return user.id;
}

beforeAll(async () => {
    client = createPgClient(DATABASE_URL, 10);
    db = drizzle(client, { schema });
    await db.execute(sql`select 1`);
    wallet = new WalletService(db);
    crypto = new CryptoService({
        get: (name: string) => (name === "encryption.keyId" ? "k1" : name === "encryption.key" ? TEST_KEY : undefined),
    } as ConfigService);
    const settings = {
        getRecharge: async () => ({ allowCustomAmount: true, minAmount: toMoneyString("10"), maxAmount: toMoneyString("10000") }),
        getSite: async () => ({ rechargeNotice: "" }),
    };
    const config = { get: (name: string) => (name === "publicUrl" ? "https://example.com" : name === "apiPrefix" ? "api" : name === "port" ? 4000 : undefined) } as ConfigService;
    payments = new PaymentsService(db, wallet, crypto, settings as never, new PaymentGatewayRegistry(new EpayAdapter()), config);
});

afterAll(async () => {
    await client.end({ timeout: 5 });
});

describe("PaymentsService.notify", () => {
    it("credits once for a signed TRADE_SUCCESS notify and ignores a duplicate", async () => {
        const userId = await createUser();
        const secret = "notify-secret";
        const encrypted = crypto.encrypt(secret);
        const [channel] = await db
            .insert(paymentChannels)
            .values({
                name: `test-${randomUUID().slice(0, 8)}`,
                driver: "epay",
                gatewayUrl: "https://zpayz.cn",
                merchantId: "2026081614592316",
                secretCipher: encrypted.cipher,
                secretKeyId: encrypted.keyId,
                methods: ["alipay"],
                extra: {},
                enabled: true,
                sortOrder: 1,
            })
            .returning();

        const pending = await wallet.createPendingOrder({
            userId,
            amount: "20.00",
            paymentProvider: "alipay",
            metadata: { channelId: channel.id, creditAmount: "20.000000" },
        });

        const params: Record<string, string> = {
            pid: channel.merchantId,
            name: "景甜画布余额充值20.00元",
            money: "20.00",
            out_trade_no: pending.orderNo,
            trade_no: "ZPAYTEST1",
            trade_status: "TRADE_SUCCESS",
            type: "alipay",
            sign_type: "MD5",
        };
        params.sign = epaySign(params, secret);

        expect(await payments.handleNotify(params)).toBe("success");
        expect((await wallet.get(userId)).balance).toBe("20.000000");
        expect(await payments.handleNotify(params)).toBe("success");
        expect((await wallet.get(userId)).balance).toBe("20.000000");

        params.money = "1.00";
        params.sign = epaySign(params, secret);
        expect(await payments.handleNotify(params)).toBe("success");
        expect((await wallet.get(userId)).balance).toBe("20.000000");
        await db.delete(paymentChannels).where(eq(paymentChannels.id, channel.id));
    });

    it("rejects a notify with a bad signature without crediting", async () => {
        const userId = await createUser();
        const secret = "notify-secret-2";
        const encrypted = crypto.encrypt(secret);
        const [channel] = await db
            .insert(paymentChannels)
            .values({
                name: `test-${randomUUID().slice(0, 8)}`,
                driver: "epay",
                gatewayUrl: "https://zpayz.cn",
                merchantId: "pid-2",
                secretCipher: encrypted.cipher,
                secretKeyId: encrypted.keyId,
                methods: ["alipay"],
                extra: {},
                enabled: true,
                sortOrder: 1,
            })
            .returning();
        const pending = await wallet.createPendingOrder({
            userId,
            amount: "10.00",
            paymentProvider: "alipay",
            metadata: { channelId: channel.id, creditAmount: "10.000000" },
        });
        const params: Record<string, string> = {
            pid: channel.merchantId,
            money: "10.00",
            out_trade_no: pending.orderNo,
            trade_status: "TRADE_SUCCESS",
            sign: "ffffffffffffffffffffffffffffffff",
        };
        expect(await payments.handleNotify(params)).toBe("fail");
        expect((await wallet.get(userId)).balance).toBe("0.000000");
        const [order] = await db.select().from(orders).where(eq(orders.orderNo, pending.orderNo));
        expect(order.status).toBe("pending");
        await db.delete(paymentChannels).where(eq(paymentChannels.id, channel.id));
    });
});
