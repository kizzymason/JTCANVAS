import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import Redis from "ioredis";
import { badRequest } from "../../common/errors";
import { REDIS } from "../../redis/redis.module";

const CHALLENGE_TTL_SECONDS = 10 * 60;
const TOKEN_TTL_SECONDS = 10 * 60;

export function isPlausibleSlide(input: { durationMs: number; points: number[] }) {
    if (!Number.isFinite(input.durationMs) || input.durationMs < 300 || input.durationMs > 60_000) return false;
    const points = input.points.filter((point) => Number.isFinite(point));
    if (points.length < 8 || points.length > 200) return false;
    if (points[0]! > 0.2) return false;
    if (points[points.length - 1]! < 0.98) return false;
    const distinct = new Set(points.map((point) => point.toFixed(2)));
    return distinct.size >= 5;
}

@Injectable()
export class SliderChallengeService {
    constructor(@Inject(REDIS) private readonly redis: Redis) {}

    async create() {
        const challengeId = randomUUID();
        await this.redis.set(`slider:challenge:${challengeId}`, "1", "EX", CHALLENGE_TTL_SECONDS);
        return { challengeId };
    }

    async verify(input: { challengeId: string; durationMs: number; points: number[] }) {
        const exists = await this.redis.get(`slider:challenge:${input.challengeId}`);
        if (!exists) throw badRequest("SLIDER_EXPIRED", "滑动验证已过期，请重试");
        if (!isPlausibleSlide(input)) throw badRequest("SLIDER_INVALID", "请重新完成滑动验证");
        await this.redis.del(`slider:challenge:${input.challengeId}`);
        const token = randomBytes(24).toString("base64url");
        await this.redis.set(`slider:token:${token}`, "1", "EX", TOKEN_TTL_SECONDS);
        return { token };
    }

    async consume(token: string) {
        const trimmed = token?.trim() ?? "";
        if (!trimmed) throw badRequest("SLIDER_REQUIRED", "请完成滑动验证");
        const used = await this.redis.getdel(`slider:token:${trimmed}`);
        if (used !== "1") throw badRequest("SLIDER_REQUIRED", "请完成滑动验证");
    }
}
