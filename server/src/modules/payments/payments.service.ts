import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, asc, eq, sql } from "drizzle-orm";
import { DB, type Database } from "../../db/db.module";
import { orders, paymentChannels, rechargePackages } from "../../db/schema";
import { badRequest, conflict, notFound } from "../../common/errors";
import { formatMoney, gte, toMoneyString } from "../../common/money";
import { CryptoService } from "../crypto/crypto.service";
import { SettingsService } from "../settings/settings.service";
import { WalletService } from "../wallet/wallet.service";
import type { CreatePaymentChannelDto, CreateRechargeDto, RechargeSettingsDto, UpdatePaymentChannelDto, UpsertRechargePackageDto } from "./dto/payments.dto";
import { isPaymentDriver, isPaymentMethod, type PaymentMethod } from "./payment-gateway";
import { PaymentGatewayRegistry } from "./payment-gateway.registry";
import { seedPaymentCatalog } from "./payments.seed";

export const RECHARGE_PRODUCT_NAME = "景甜画布余额充值";
const METHOD_LABELS: Record<PaymentMethod, string> = { alipay: "支付宝", wxpay: "微信支付" };

type ChannelRow = typeof paymentChannels.$inferSelect;
type PackageRow = typeof rechargePackages.$inferSelect;

@Injectable()
export class PaymentsService implements OnModuleInit {
    private readonly logger = new Logger(PaymentsService.name);

    constructor(
        @Inject(DB) private readonly db: Database,
        private readonly wallet: WalletService,
        private readonly crypto: CryptoService,
        private readonly settings: SettingsService,
        private readonly gateways: PaymentGatewayRegistry,
        private readonly config: ConfigService,
    ) {}

    async onModuleInit() {
        const result = await seedPaymentCatalog(this.db, {
            pid: process.env.ZPAY_PID?.trim(),
            key: process.env.ZPAY_KEY?.trim(),
            gateway: process.env.ZPAY_GATEWAY?.trim(),
            crypto: this.crypto,
        });
        this.logger.log(
            `Payment catalog ${result.channelCreated ? "created" : "ensured"} channel=${result.channelId ?? "-"} keyUpdated=${result.keyUpdated} packagesCreated=${result.packagesCreated}`,
        );
    }

    async catalog() {
        const [packages, channels, recharge, site] = await Promise.all([
            this.db.select().from(rechargePackages).where(eq(rechargePackages.enabled, true)).orderBy(asc(rechargePackages.sortOrder), asc(rechargePackages.createdAt)),
            this.listUsableChannels(),
            this.settings.getRecharge(),
            this.settings.getSite(),
        ]);
        const methods = this.collectMethods(channels);
        return {
            packages: packages.map((item) => ({
                id: item.id,
                name: item.name,
                faceValue: item.faceValue,
                salePrice: item.salePrice,
            })),
            allowCustomAmount: recharge.allowCustomAmount,
            minAmount: recharge.minAmount,
            maxAmount: recharge.maxAmount,
            methods,
            notice: site.rechargeNotice,
            available: methods.length > 0 && (packages.length > 0 || recharge.allowCustomAmount),
        };
    }

    async createRecharge(params: { userId: string; body: CreateRechargeDto; clientIp: string; userAgent: string }) {
        const method = params.body.method;
        const pricing = await this.resolvePricing(params.body);
        const channel = await this.pickChannel(method, params.body.channelId);
        const secret = this.decryptSecret(channel);
        const productName = `${RECHARGE_PRODUCT_NAME}${formatMoney(pricing.creditAmount)}元`;
        const order = await this.wallet.createPendingOrder({
            userId: params.userId,
            amount: pricing.salePrice,
            paymentProvider: method,
            metadata: {
                channelId: channel.id,
                driver: channel.driver,
                method,
                packageId: pricing.packageId ?? "",
                creditAmount: pricing.creditAmount,
                productName,
            },
        });

        const gateway = this.gateways.resolve(channel.driver);
        const checkout = await gateway.createCheckout({
            gatewayUrl: channel.gatewayUrl,
            merchantId: channel.merchantId,
            secret,
            method,
            orderNo: order.orderNo,
            money: formatMoney(pricing.salePrice),
            name: productName,
            notifyUrl: this.callbackUrl("notify"),
            returnUrl: this.callbackUrl("return"),
            clientIp: normalizeClientIp(params.clientIp),
            cid: extraCid(channel.extra),
            device: /mobile|android|iphone|ipad/i.test(params.userAgent) ? "mobile" : "pc",
        });

        return {
            orderNo: order.orderNo,
            amount: order.amount,
            creditAmount: pricing.creditAmount,
            method,
            payUrl: checkout.payUrl,
            qrcode: checkout.qrcode ?? "",
            img: checkout.img ?? "",
        };
    }

    async getUserOrder(userId: string, orderNo: string) {
        const order = await this.wallet.getOwnedOrder(userId, orderNo);
        if (order.status === "pending") {
            await this.trySettleFromGateway(order);
            return this.publicOrder(await this.wallet.getOwnedOrder(userId, orderNo));
        }
        return this.publicOrder(order);
    }

    /** Z-Pay notify: must reply with the literal body `success` on duplicate and first success. */
    async handleNotify(params: Record<string, string>): Promise<"success" | "fail"> {
        try {
            await this.settleFromNotify(params);
            return "success";
        } catch (error) {
            this.logger.warn(`payment notify rejected: ${error instanceof Error ? error.message : "unknown"}`);
            return "fail";
        }
    }

    async handleReturn(params: Record<string, string>) {
        try {
            if (params.out_trade_no) await this.settleFromNotify(params);
        } catch (error) {
            this.logger.warn(`payment return ignored: ${error instanceof Error ? error.message : "unknown"}`);
        }
        return this.frontendReturnUrl();
    }

    async listAdminChannels() {
        const rows = await this.db.select().from(paymentChannels).orderBy(asc(paymentChannels.sortOrder), asc(paymentChannels.createdAt));
        return rows.map((row) => this.toAdminChannel(row));
    }

    async createChannel(input: CreatePaymentChannelDto) {
        this.assertChannel(input);
        if (!input.secret.trim()) throw badRequest("PAYMENT_SECRET_REQUIRED", "请填写商户密钥");
        const encrypted = this.crypto.encrypt(input.secret.trim());
        const [created] = await this.db
            .insert(paymentChannels)
            .values({
                name: input.name.trim(),
                driver: input.driver,
                gatewayUrl: trimSlash(input.gatewayUrl),
                merchantId: input.merchantId.trim(),
                secretCipher: encrypted.cipher,
                secretKeyId: encrypted.keyId,
                methods: uniqueMethods(input.methods),
                extra: input.cid?.trim() ? { cid: input.cid.trim() } : {},
                enabled: input.enabled ?? true,
                sortOrder: input.sortOrder ?? 100,
            })
            .returning();
        return { id: created.id, audit: { targetId: created.id, after: auditChannel(created) } };
    }

    async updateChannel(id: string, input: UpdatePaymentChannelDto) {
        this.assertChannel(input);
        const [before] = await this.db.select().from(paymentChannels).where(eq(paymentChannels.id, id)).limit(1);
        if (!before) throw notFound("支付渠道不存在");
        const encrypted = input.secret?.trim() ? this.crypto.encrypt(input.secret.trim()) : null;
        const [after] = await this.db
            .update(paymentChannels)
            .set({
                name: input.name.trim(),
                driver: input.driver,
                gatewayUrl: trimSlash(input.gatewayUrl),
                merchantId: input.merchantId.trim(),
                ...(encrypted ? { secretCipher: encrypted.cipher, secretKeyId: encrypted.keyId } : {}),
                methods: uniqueMethods(input.methods),
                extra: input.cid?.trim() ? { cid: input.cid.trim() } : {},
                enabled: input.enabled ?? before.enabled,
                sortOrder: input.sortOrder ?? before.sortOrder,
                updatedAt: new Date(),
            })
            .where(eq(paymentChannels.id, id))
            .returning();
        return { id, audit: { targetId: id, before: auditChannel(before), after: auditChannel(after) } };
    }

    async deleteChannel(id: string) {
        const pending = await this.db
            .select({ total: sql<number>`count(*)::int` })
            .from(orders)
            .where(and(eq(orders.status, "pending"), sql`${orders.metadata}->>'channelId' = ${id}`));
        if ((pending[0]?.total ?? 0) > 0) throw conflict("PAYMENT_CHANNEL_IN_USE", "仍有未支付订单使用该渠道，无法删除");
        const removed = await this.db.delete(paymentChannels).where(eq(paymentChannels.id, id)).returning();
        if (!removed.length) throw notFound("支付渠道不存在");
        return { id, audit: { targetId: id, before: auditChannel(removed[0]) } };
    }

    async channelBalance(id: string) {
        const channel = await this.requireChannel(id);
        const secret = this.decryptSecret(channel);
        const balance = await this.gateways.resolve(channel.driver).queryBalance({
            gatewayUrl: channel.gatewayUrl,
            merchantId: channel.merchantId,
            secret,
        });
        return { balance };
    }

    async listAdminPackages() {
        const [items, settings] = await Promise.all([
            this.db.select().from(rechargePackages).orderBy(asc(rechargePackages.sortOrder), asc(rechargePackages.createdAt)),
            this.settings.getRecharge(),
        ]);
        return { items, settings };
    }

    async createPackage(input: UpsertRechargePackageDto) {
        this.assertPackage(input);
        const [created] = await this.db
            .insert(rechargePackages)
            .values({
                name: input.name.trim(),
                faceValue: toMoneyString(input.faceValue),
                salePrice: toMoneyString(input.salePrice),
                enabled: input.enabled ?? true,
                sortOrder: input.sortOrder ?? 100,
            })
            .returning();
        return { id: created.id, audit: { targetId: created.id, after: auditPackage(created) } };
    }

    async updatePackage(id: string, input: UpsertRechargePackageDto) {
        this.assertPackage(input);
        const [before] = await this.db.select().from(rechargePackages).where(eq(rechargePackages.id, id)).limit(1);
        if (!before) throw notFound("充值套餐不存在");
        const [after] = await this.db
            .update(rechargePackages)
            .set({
                name: input.name.trim(),
                faceValue: toMoneyString(input.faceValue),
                salePrice: toMoneyString(input.salePrice),
                enabled: input.enabled ?? before.enabled,
                sortOrder: input.sortOrder ?? before.sortOrder,
                updatedAt: new Date(),
            })
            .where(eq(rechargePackages.id, id))
            .returning();
        return { id, audit: { targetId: id, before: auditPackage(before), after: auditPackage(after) } };
    }

    async deletePackage(id: string) {
        const removed = await this.db.delete(rechargePackages).where(eq(rechargePackages.id, id)).returning();
        if (!removed.length) throw notFound("充值套餐不存在");
        return { id, audit: { targetId: id, before: auditPackage(removed[0]) } };
    }

    async saveRechargeSettings(input: RechargeSettingsDto, updatedBy: string) {
        const minAmount = toMoneyString(input.minAmount);
        const maxAmount = toMoneyString(input.maxAmount);
        if (!gte(minAmount, "0.01")) throw badRequest("RECHARGE_MIN_INVALID", "最小充值金额不能低于 0.01 元");
        if (!gte(maxAmount, minAmount)) throw badRequest("RECHARGE_MAX_INVALID", "最大充值金额不能小于最小金额");
        const before = await this.settings.getRecharge();
        const after = await this.settings.saveRecharge({ allowCustomAmount: input.allowCustomAmount, minAmount, maxAmount }, updatedBy);
        return { settings: after, audit: { targetId: "recharge", before, after } };
    }

    private async settleFromNotify(params: Record<string, string>) {
        const orderNo = params.out_trade_no?.trim();
        if (!orderNo) throw badRequest("PAYMENT_NOTIFY_INVALID", "缺少商户订单号");

        const [order] = await this.db.select().from(orders).where(eq(orders.orderNo, orderNo)).limit(1);
        if (!order) throw notFound("订单不存在");

        const channelId = typeof order.metadata.channelId === "string" ? order.metadata.channelId : "";
        const channel = await this.requireChannel(channelId);
        const secret = this.decryptSecret(channel);
        const gateway = this.gateways.resolve(channel.driver);
        if (!gateway.verifyNotify(params, secret)) throw badRequest("PAYMENT_SIGN_INVALID", "支付签名校验失败");
        if (params.pid && params.pid !== channel.merchantId) throw badRequest("PAYMENT_PID_MISMATCH", "商户号不匹配");
        if (params.trade_status && params.trade_status !== "TRADE_SUCCESS") {
            throw badRequest("PAYMENT_NOT_SUCCESS", "支付未成功");
        }
        if (order.status === "paid") return;

        const paidAmount = params.money || order.amount;
        await this.wallet.fulfillPendingOrder({
            orderNo,
            paidAmount,
            providerTxnId: params.trade_no ?? "",
            note: "在线充值",
        });
    }

    private async trySettleFromGateway(order: typeof orders.$inferSelect) {
        const channelId = typeof order.metadata.channelId === "string" ? order.metadata.channelId : "";
        if (!channelId) return;
        try {
            const channel = await this.requireChannel(channelId);
            const secret = this.decryptSecret(channel);
            const queried = await this.gateways.resolve(channel.driver).queryOrder({
                gatewayUrl: channel.gatewayUrl,
                merchantId: channel.merchantId,
                secret,
                orderNo: order.orderNo,
            });
            if (!queried.paid) return;
            await this.wallet.fulfillPendingOrder({
                orderNo: order.orderNo,
                paidAmount: queried.money || order.amount,
                providerTxnId: queried.tradeNo ?? "",
                note: "在线充值",
            });
        } catch (error) {
            this.logger.warn(`payment query skipped: ${error instanceof Error ? error.message : "unknown"}`);
        }
    }

    private async resolvePricing(body: CreateRechargeDto) {
        if (body.packageId) {
            const [pkg] = await this.db
                .select()
                .from(rechargePackages)
                .where(and(eq(rechargePackages.id, body.packageId), eq(rechargePackages.enabled, true)))
                .limit(1);
            if (!pkg) throw notFound("充值套餐不存在或已停用");
            return { salePrice: toMoneyString(pkg.salePrice), creditAmount: toMoneyString(pkg.faceValue), packageId: pkg.id };
        }
        const recharge = await this.settings.getRecharge();
        if (!recharge.allowCustomAmount) throw badRequest("CUSTOM_RECHARGE_DISABLED", "当前未开放自定义金额充值");
        const amount = toMoneyString(body.amount ?? "0");
        if (!gte(amount, recharge.minAmount)) throw badRequest("RECHARGE_BELOW_MIN", `最低充值 ${formatMoney(recharge.minAmount)} 元`);
        if (!gte(recharge.maxAmount, amount)) throw badRequest("RECHARGE_ABOVE_MAX", `单笔最多充值 ${formatMoney(recharge.maxAmount)} 元`);
        return { salePrice: amount, creditAmount: amount, packageId: undefined };
    }

    private async pickChannel(method: PaymentMethod, channelId?: string) {
        if (channelId) {
            const channel = await this.requireChannel(channelId);
            if (!channel.enabled || !channel.secretCipher || !channel.merchantId) throw badRequest("PAYMENT_CHANNEL_DISABLED", "该支付渠道不可用");
            if (!channel.methods.includes(method)) throw badRequest("PAYMENT_METHOD_UNAVAILABLE", "该渠道不支持所选支付方式");
            this.gateways.resolve(channel.driver);
            return channel;
        }
        const channels = await this.listUsableChannels();
        const match = channels.find((channel) => channel.methods.includes(method));
        if (!match) throw badRequest("PAYMENT_METHOD_UNAVAILABLE", "当前没有可用的支付方式，请联系管理员配置");
        return match;
    }

    private async listUsableChannels() {
        const rows = await this.db
            .select()
            .from(paymentChannels)
            .where(eq(paymentChannels.enabled, true))
            .orderBy(asc(paymentChannels.sortOrder), asc(paymentChannels.createdAt));
        return rows.filter((row) => row.secretCipher && row.merchantId && isPaymentDriver(row.driver));
    }

    private collectMethods(channels: ChannelRow[]) {
        const seen = new Set<PaymentMethod>();
        const methods: Array<{ method: PaymentMethod; label: string; channelId: string }> = [];
        for (const channel of channels) {
            for (const raw of channel.methods) {
                if (!isPaymentMethod(raw) || seen.has(raw)) continue;
                seen.add(raw);
                methods.push({ method: raw, label: METHOD_LABELS[raw], channelId: channel.id });
            }
        }
        return methods;
    }

    private async requireChannel(id: string) {
        if (!id) throw notFound("支付渠道不存在");
        const [channel] = await this.db.select().from(paymentChannels).where(eq(paymentChannels.id, id)).limit(1);
        if (!channel) throw notFound("支付渠道不存在");
        return channel;
    }

    private decryptSecret(channel: ChannelRow) {
        if (!channel.secretCipher) throw badRequest("PAYMENT_SECRET_MISSING", "支付渠道尚未配置密钥");
        return this.crypto.decrypt(channel.secretCipher, channel.secretKeyId);
    }

    private toAdminChannel(row: ChannelRow) {
        return {
            id: row.id,
            name: row.name,
            driver: row.driver,
            gatewayUrl: row.gatewayUrl,
            merchantId: row.merchantId,
            methods: row.methods,
            cid: extraCid(row.extra),
            enabled: row.enabled,
            sortOrder: row.sortOrder,
            hasSecret: Boolean(row.secretCipher),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }

    private publicOrder(order: typeof orders.$inferSelect) {
        const creditRaw = order.metadata.creditAmount;
        return {
            orderNo: order.orderNo,
            amount: order.amount,
            creditAmount: typeof creditRaw === "string" && creditRaw ? creditRaw : order.amount,
            status: order.status,
            paymentProvider: order.paymentProvider,
            paidAt: order.paidAt,
            createdAt: order.createdAt,
        };
    }

    private assertChannel(input: { driver: string; merchantId: string; methods: string[] }) {
        if (!isPaymentDriver(input.driver)) throw badRequest("PAYMENT_DRIVER_INVALID", "不支持的支付协议");
        if (!input.merchantId.trim()) throw badRequest("PAYMENT_PID_REQUIRED", "请填写商户 ID");
        if (!input.methods.length) throw badRequest("PAYMENT_METHODS_REQUIRED", "请至少选择一种支付方式");
    }

    private assertPackage(input: UpsertRechargePackageDto) {
        const face = toMoneyString(input.faceValue);
        const sale = toMoneyString(input.salePrice);
        if (!gte(face, "0.01") || !gte(sale, "0.01")) throw badRequest("PACKAGE_AMOUNT_INVALID", "套餐金额必须大于 0");
        if (!gte("100000.000000", face) || !gte("100000.000000", sale)) throw badRequest("PACKAGE_AMOUNT_INVALID", "套餐金额不能超过 100000 元");
    }

    private callbackUrl(kind: "notify" | "return") {
        const origin = this.publicOrigin();
        const prefix = this.config.get<string>("apiPrefix") || "api";
        return `${origin}/${prefix}/payments/epay/${kind}`;
    }

    private frontendReturnUrl() {
        const origin = this.config.get<string>("publicUrl") || "";
        return origin ? `${origin}/canvas?recharge=1` : "/canvas?recharge=1";
    }

    private publicOrigin() {
        const origin = this.config.get<string>("publicUrl") || "";
        if (origin) return origin;
        const port = this.config.get<number>("port") ?? 4000;
        return `http://127.0.0.1:${port}`;
    }
}

function trimSlash(url: string) {
    return url.replace(/\/+$/, "");
}

function extraCid(extra: Record<string, unknown>) {
    return typeof extra.cid === "string" ? extra.cid : "";
}

function uniqueMethods(methods: string[]) {
    return [...new Set(methods.filter(isPaymentMethod))];
}

function auditChannel(row: ChannelRow) {
    return {
        name: row.name,
        driver: row.driver,
        gatewayUrl: row.gatewayUrl,
        merchantId: row.merchantId,
        methods: row.methods,
        enabled: row.enabled,
        hasSecret: Boolean(row.secretCipher),
    };
}

function auditPackage(row: PackageRow) {
    return { name: row.name, faceValue: row.faceValue, salePrice: row.salePrice, enabled: row.enabled, sortOrder: row.sortOrder };
}

function normalizeClientIp(ip: string) {
    const trimmed = ip.trim();
    if (!trimmed || trimmed === "::1") return "127.0.0.1";
    if (trimmed.startsWith("::ffff:")) return trimmed.slice(7);
    return trimmed;
}