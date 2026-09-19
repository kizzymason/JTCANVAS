/** ISO-8601 timestamptz for interpolating into `sql\`...\``. Never pass a Date object: postgres.js stringifies it as `Wed Sep 02 2026 ...` and PostgreSQL rejects the query. */
export function toIsoTimestamptz(at: Date): string {
    if (Number.isNaN(at.getTime())) {
        throw new Error("invalid date");
    }
    return at.toISOString();
}

/** Coerce Drizzle/postgres.js count payloads (number, numeric string, bigint) into a safe int. */
export function asInt(value: unknown): number {
    if (typeof value === "bigint") {
        const n = Number(value);
        return Number.isFinite(n) ? Math.trunc(n) : 0;
    }
    if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : 0;
    if (typeof value === "string" && value.trim()) {
        const n = Number(value);
        return Number.isFinite(n) ? Math.trunc(n) : 0;
    }
    return 0;
}
