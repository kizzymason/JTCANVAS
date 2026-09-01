import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import Redis from "ioredis";
import { DB, type Database } from "../../db/db.module";
import { settings } from "../../db/schema";
import { REDIS } from "../../redis/redis.module";

/** Keys are typed so a typo cannot silently create a new setting. */
export type SiteSettings = {
    registrationEnabled: boolean;
    /** Balance credited on registration. Default 0: users must top up before generating. */
    newUserGiftAmount: string;
    siteName: string;
    /** Shown on the top-up page while no payment gateway is connected. */
    rechargeNotice: string;
    imageGenerationEnabled: boolean;
    videoGenerationEnabled: boolean;
    agentEnabled: boolean;
};

export type PublicSiteInfo = Pick<SiteSettings, "siteName" | "registrationEnabled" | "rechargeNotice" | "imageGenerationEnabled" | "videoGenerationEnabled" | "agentEnabled">;

export type RechargeSettings = {
    allowCustomAmount: boolean;
    /** Custom top-up floor, NUMERIC string. Default 10. */
    minAmount: string;
    /** Custom top-up ceiling, NUMERIC string. Default 10000. */
    maxAmount: string;
};

export type StorageSettings = {
    driver: "local" | "s3";
    s3: {
        endpoint: string;
        region: string;
        bucket: string;
        accessKeyId: string;
        /** Stored encrypted; blank in API responses. */
        secretAccessKeyCipher: string;
        secretAccessKeyId: string;
        forcePathStyle: boolean;
        publicBaseUrl: string;
    };
};

const SITE_KEY = "site";
const STORAGE_KEY = "storage";
const RECHARGE_KEY = "recharge";
const CACHE_PREFIX = "settings:";
const CACHE_TTL_SECONDS = 300;

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
    registrationEnabled: true,
    newUserGiftAmount: "0",
    siteName: "景甜Canvas AI创作画布",
    rechargeNotice: "",
    imageGenerationEnabled: true,
    videoGenerationEnabled: true,
    agentEnabled: true,
};

export const DEFAULT_RECHARGE_SETTINGS: RechargeSettings = {
    allowCustomAmount: true,
    minAmount: "10.000000",
    maxAmount: "10000.000000",
};

const LEGACY_SITE_NAMES = new Set(["无限画布", "景甜画布"]);

export function toPublicSite(site: SiteSettings): PublicSiteInfo {
    return {
        siteName: site.siteName,
        registrationEnabled: site.registrationEnabled,
        rechargeNotice: site.rechargeNotice,
        imageGenerationEnabled: site.imageGenerationEnabled,
        videoGenerationEnabled: site.videoGenerationEnabled,
        agentEnabled: site.agentEnabled,
    };
}

export const DEFAULT_STORAGE_SETTINGS: StorageSettings = {
    driver: "local",
    s3: { endpoint: "", region: "us-east-1", bucket: "", accessKeyId: "", secretAccessKeyCipher: "", secretAccessKeyId: "", forcePathStyle: true, publicBaseUrl: "" },
};

@Injectable()
export class SettingsService {
    constructor(
        @Inject(DB) private readonly db: Database,
        @Inject(REDIS) private readonly redis: Redis,
    ) {}

    async getSite() {
        const site = await this.read(SITE_KEY, DEFAULT_SITE_SETTINGS);
        if (!LEGACY_SITE_NAMES.has(site.siteName)) return site;
        const next = { ...site, siteName: DEFAULT_SITE_SETTINGS.siteName };
        await this.write(SITE_KEY, next);
        return next;
    }

    getStorage() {
        return this.read(STORAGE_KEY, DEFAULT_STORAGE_SETTINGS);
    }

    getRecharge() {
        return this.read(RECHARGE_KEY, DEFAULT_RECHARGE_SETTINGS);
    }

    async saveSite(patch: Partial<SiteSettings>, updatedBy?: string) {
        const current = await this.getSite();
        const next: SiteSettings = { ...current };
        (Object.keys(patch) as Array<keyof SiteSettings>).forEach((key) => {
            const value = patch[key];
            if (value !== undefined) (next[key] as SiteSettings[typeof key]) = value;
        });
        return this.write(SITE_KEY, next, updatedBy);
    }

    saveStorage(value: StorageSettings, updatedBy?: string) {
        return this.write(STORAGE_KEY, value, updatedBy);
    }

    saveRecharge(value: RechargeSettings, updatedBy?: string) {
        return this.write(RECHARGE_KEY, value, updatedBy);
    }

    private async read<T>(key: string, fallback: T): Promise<T> {
        const cached = await this.redis.get(CACHE_PREFIX + key);
        if (cached) return { ...fallback, ...(JSON.parse(cached) as T) };
        const [row] = await this.db.select().from(settings).where(eq(settings.key, key)).limit(1);
        const value = { ...fallback, ...((row?.value as T | undefined) ?? {}) };
        await this.redis.set(CACHE_PREFIX + key, JSON.stringify(value), "EX", CACHE_TTL_SECONDS);
        return value;
    }

    private async write<T extends Record<string, unknown>>(key: string, value: T, updatedBy?: string) {
        await this.db
            .insert(settings)
            .values({ key, value, updatedBy: updatedBy ?? null })
            .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: updatedBy ?? null, updatedAt: new Date() } });
        await this.redis.del(CACHE_PREFIX + key);
        return value;
    }
}
