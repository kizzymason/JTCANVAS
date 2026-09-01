/**
 * Fail fast on boot rather than at the first request. Missing DATABASE_URL or a short encryption key
 * are the two mistakes that would otherwise surface as corrupted data instead of a startup error.
 */
export function validateEnv(raw: Record<string, unknown>) {
    const errors: string[] = [];
    const databaseUrl = String(raw.DATABASE_URL || "");
    if (!databaseUrl) errors.push("DATABASE_URL is required");
    else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) errors.push("DATABASE_URL must be a postgres:// connection string");

    const encryptionKey = String(raw.APP_ENCRYPTION_KEY || "");
    if (!encryptionKey) errors.push("APP_ENCRYPTION_KEY is required");
    else if (decodeKeyLength(encryptionKey) !== 32) errors.push("APP_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars or 44 base64 chars)");

    if (errors.length) throw new Error(`Invalid environment configuration:\n  - ${errors.join("\n  - ")}`);
    return raw;
}

function decodeKeyLength(value: string) {
    if (/^[0-9a-f]{64}$/i.test(value)) return 32;
    try {
        return Buffer.from(value, "base64").length;
    } catch {
        return 0;
    }
}
