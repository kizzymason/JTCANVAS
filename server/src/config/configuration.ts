export type AppConfig = ReturnType<typeof configuration>;

function int(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean) {
    if (value === undefined || value === "") return fallback;
    return value === "1" || value.toLowerCase() === "true";
}

function list(value: string | undefined) {
    return (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

export function configuration() {
    return {
        env: process.env.NODE_ENV || "development",
        port: int(process.env.PORT, 4000),
        /** Mounted behind nginx at /api, so every route carries this prefix. */
        apiPrefix: process.env.API_PREFIX || "api",
        trustProxy: bool(process.env.TRUST_PROXY, true),
        corsOrigins: list(process.env.CORS_ORIGINS),
        logLevel: process.env.LOG_LEVEL || "info",

        database: {
            url: process.env.DATABASE_URL!,
            poolMax: int(process.env.DATABASE_POOL_MAX, 10),
        },

        redis: {
            url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
        },

        session: {
            cookieName: process.env.SESSION_COOKIE_NAME || "ic_session",
            /** 30 days, refreshed on every authenticated request. */
            ttlSeconds: int(process.env.SESSION_TTL_SECONDS, 60 * 60 * 24 * 30),
            cookieSecure: bool(process.env.SESSION_COOKIE_SECURE, process.env.NODE_ENV === "production"),
            cookieDomain: process.env.SESSION_COOKIE_DOMAIN || undefined,
        },

        /** 32-byte key, hex or base64, used for AES-256-GCM at-rest encryption of provider credentials. */
        encryption: {
            key: process.env.APP_ENCRYPTION_KEY!,
            keyId: process.env.APP_ENCRYPTION_KEY_ID || "k1",
        },

        storage: {
            /** Absolute path used by the local-disk driver, also exposed to nginx for X-Accel-Redirect. */
            localRoot: process.env.STORAGE_LOCAL_ROOT || "/data/storage",
            /** nginx internal location that maps to localRoot. */
            internalPrefix: process.env.STORAGE_INTERNAL_PREFIX || "/internal-files",
            signedUrlTtlSeconds: int(process.env.STORAGE_SIGNED_URL_TTL_SECONDS, 3600),
            /**
             * When true, `/api/files` answers with X-Accel-Redirect and nginx reads the disk.
             * Local `npm run dev` has no nginx, so this defaults off outside production.
             */
            xAccelRedirect: bool(process.env.STORAGE_X_ACCEL_REDIRECT, process.env.NODE_ENV === "production"),
        },

        generation: {
            workerConcurrency: int(process.env.GENERATION_WORKER_CONCURRENCY, 4),
            maxActiveTasksPerUser: int(process.env.GENERATION_MAX_ACTIVE_PER_USER, 3),
            imagePollTimeoutMs: int(process.env.GENERATION_IMAGE_TIMEOUT_MS, 5 * 60 * 1000),
            videoPollTimeoutMs: int(process.env.GENERATION_VIDEO_TIMEOUT_MS, 30 * 60 * 1000),
            pollIntervalMs: int(process.env.GENERATION_POLL_INTERVAL_MS, 2500),
            attempts: int(process.env.GENERATION_ATTEMPTS, 3),
        },

        script: {
            memoryLimitMb: int(process.env.SCRIPT_MEMORY_LIMIT_MB, 128),
            timeoutMs: int(process.env.SCRIPT_TIMEOUT_MS, 60_000),
            allowedHosts: list(process.env.SCRIPT_ALLOWED_HOSTS),
        },
    };
}
