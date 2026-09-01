import { eq, sql } from "drizzle-orm";
import type { Database } from "../../db/db.module";
import { paymentChannels, rechargePackages } from "../../db/schema";
import { toMoneyString } from "../../common/money";

export const ZPAY_DEFAULT_GATEWAY = "https://zpayz.cn";
export const ZPAY_CHANNEL_NAME = "Z-Pay";

const DEFAULT_PACKAGES: Array<{ name: string; faceValue: string; salePrice: string; sortOrder: number }> = [
    { name: "10元", faceValue: "10", salePrice: "10", sortOrder: 10 },
    { name: "20元", faceValue: "20", salePrice: "20", sortOrder: 20 },
    { name: "50元", faceValue: "50", salePrice: "50", sortOrder: 50 },
    { name: "100元", faceValue: "100", salePrice: "100", sortOrder: 100 },
];

export type PaymentCatalogSeedResult = {
    channelCreated: boolean;
    channelId: string | null;
    keyUpdated: boolean;
    packagesCreated: number;
};

export type PaymentSeedCrypto = {
    encrypt: (plaintext: string) => { cipher: string; keyId: string };
};

/**
 * Seeds only when the catalog is empty. An admin who added, renamed, repriced or deleted
 * channels/packages will not have those rows recreated or overwritten on restart.
 * A stored secret is never replaced; env ZPAY_KEY is written only when the row has none.
 */
export async function seedPaymentCatalog(
    db: Database,
    options?: { pid?: string; key?: string; gateway?: string; crypto?: PaymentSeedCrypto },
): Promise<PaymentCatalogSeedResult> {
    return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('payments.ensure-catalog'))`);

        let channelCreated = false;
        let keyUpdated = false;
        let channelId: string | null = null;

        const [channelCount] = await tx.select({ total: sql<number>`count(*)::int` }).from(paymentChannels);
        if ((channelCount?.total ?? 0) === 0) {
            const pid = options?.pid?.trim() ?? "";
            const key = options?.key?.trim() ?? "";
            const encrypted = key && options?.crypto ? options.crypto.encrypt(key) : { cipher: "", keyId: "" };
            const [created] = await tx
                .insert(paymentChannels)
                .values({
                    name: ZPAY_CHANNEL_NAME,
                    driver: "epay",
                    gatewayUrl: (options?.gateway?.trim() || ZPAY_DEFAULT_GATEWAY).replace(/\/+$/, ""),
                    merchantId: pid,
                    secretCipher: encrypted.cipher,
                    secretKeyId: encrypted.keyId,
                    methods: ["alipay"],
                    extra: {},
                    enabled: Boolean(pid && encrypted.cipher),
                    sortOrder: 10,
                })
                .returning();
            channelCreated = true;
            keyUpdated = Boolean(encrypted.cipher);
            channelId = created.id;
        } else if (options?.key && options.crypto) {
            const [existing] = await tx.select().from(paymentChannels).where(eq(paymentChannels.name, ZPAY_CHANNEL_NAME)).limit(1);
            if (existing && !existing.secretCipher) {
                const encrypted = options.crypto.encrypt(options.key.trim());
                const [updated] = await tx
                    .update(paymentChannels)
                    .set({
                        secretCipher: encrypted.cipher,
                        secretKeyId: encrypted.keyId,
                        merchantId: existing.merchantId || options.pid?.trim() || existing.merchantId,
                        enabled: existing.enabled || Boolean((existing.merchantId || options.pid?.trim()) && encrypted.cipher),
                        updatedAt: new Date(),
                    })
                    .where(eq(paymentChannels.id, existing.id))
                    .returning();
                keyUpdated = true;
                channelId = updated.id;
            } else {
                channelId = existing?.id ?? null;
            }
        } else {
            const [existing] = await tx.select({ id: paymentChannels.id }).from(paymentChannels).limit(1);
            channelId = existing?.id ?? null;
        }

        let packagesCreated = 0;
        const [packageCount] = await tx.select({ total: sql<number>`count(*)::int` }).from(rechargePackages);
        if ((packageCount?.total ?? 0) === 0) {
            await tx.insert(rechargePackages).values(
                DEFAULT_PACKAGES.map((item) => ({
                    name: item.name,
                    faceValue: toMoneyString(item.faceValue),
                    salePrice: toMoneyString(item.salePrice),
                    enabled: true,
                    sortOrder: item.sortOrder,
                })),
            );
            packagesCreated = DEFAULT_PACKAGES.length;
        }

        return { channelCreated, channelId, keyUpdated, packagesCreated };
    });
}
