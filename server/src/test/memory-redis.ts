/**
 * In-memory stand-in for the ioredis commands used by visitor UV sets, slider tokens,
 * registration hourly caps and redeem cooldowns. Specs only; not wired into the app.
 */
export class MemoryRedis {
    private readonly kv = new Map<string, { value: string; members?: Set<string>; expires?: number }>();

    private alive(key: string) {
        const row = this.kv.get(key);
        if (!row) return undefined;
        if (row.expires !== undefined && row.expires < Date.now()) {
            this.kv.delete(key);
            return undefined;
        }
        return row;
    }

    async get(key: string) {
        return this.alive(key)?.value ?? null;
    }

    async set(key: string, value: string, ...args: Array<string | number>) {
        let ttlMs: number | undefined;
        let nx = false;
        for (let index = 0; index < args.length; index += 1) {
            const token = args[index];
            if (token === "EX") {
                ttlMs = Number(args[index + 1]) * 1000;
                index += 1;
            }
            if (token === "NX") nx = true;
        }
        if (nx && this.alive(key)) return null;
        const previous = this.alive(key);
        this.kv.set(key, { value, members: previous?.members, expires: ttlMs !== undefined ? Date.now() + ttlMs : previous?.expires });
        return "OK";
    }

    async del(...keys: string[]) {
        let removed = 0;
        for (const key of keys) {
            if (this.kv.delete(key)) removed += 1;
        }
        return removed;
    }

    async getdel(key: string) {
        const value = await this.get(key);
        await this.del(key);
        return value;
    }

    async incr(key: string) {
        const row = this.alive(key);
        const next = String(Number(row?.value ?? "0") + 1);
        this.kv.set(key, { value: next, expires: row?.expires, members: row?.members });
        return Number(next);
    }

    async expire(key: string, seconds: number) {
        const row = this.alive(key);
        if (!row) return 0;
        row.expires = Date.now() + seconds * 1000;
        return 1;
    }

    async exists(...keys: string[]) {
        return keys.filter((key) => this.alive(key)).length;
    }

    async sadd(key: string, member: string) {
        let row = this.alive(key);
        if (!row) {
            row = { value: "", members: new Set() };
            this.kv.set(key, row);
        }
        if (!row.members) row.members = new Set();
        const before = row.members.size;
        row.members.add(member);
        return row.members.size > before ? 1 : 0;
    }

    async sismember(key: string, member: string) {
        return this.alive(key)?.members?.has(member) ? 1 : 0;
    }
}
