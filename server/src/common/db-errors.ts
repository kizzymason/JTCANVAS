/** Postgres SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION = "23505";
/** How far to walk before giving up, so a self-referencing cause cannot spin. */
const MAX_CAUSE_DEPTH = 5;

/**
 * True when an error is a unique-constraint violation.
 *
 * Drizzle wraps a failed statement in its own error and nests the driver's error underneath, so the
 * SQLSTATE is not on the object that gets thrown — checking `error.code` directly silently misses
 * every one of them. That mistake shipped once already and turned a routine idempotent replay into
 * a 500, which is why this lives in one tested place rather than being re-derived per call site.
 */
export function isUniqueViolation(error: unknown) {
    return hasSqlState(error, UNIQUE_VIOLATION);
}

export function hasSqlState(error: unknown, code: string) {
    let current = error;
    for (let depth = 0; current && depth < MAX_CAUSE_DEPTH; depth += 1) {
        if (typeof current === "object" && (current as { code?: string }).code === code) return true;
        current = (current as { cause?: unknown }).cause;
    }
    return false;
}
