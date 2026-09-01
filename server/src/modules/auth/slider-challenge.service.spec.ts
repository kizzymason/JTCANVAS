import { describe, expect, it } from "vitest";
import { AppError } from "../../common/errors";
import { MemoryRedis } from "../../test/memory-redis";
import { isPlausibleSlide, SliderChallengeService } from "./slider-challenge.service";

const POINTS = [0, 0.12, 0.28, 0.41, 0.55, 0.7, 0.86, 1];

describe("isPlausibleSlide", () => {
    it("rejects an instant jump to the end", () => {
        expect(isPlausibleSlide({ durationMs: 50, points: POINTS })).toBe(false);
        expect(isPlausibleSlide({ durationMs: 400, points: [1, 1, 1, 1, 1, 1, 1, 1] })).toBe(false);
        expect(isPlausibleSlide({ durationMs: 400, points: POINTS })).toBe(true);
    });
});

describe("SliderChallengeService", () => {
    it("issues a one-time token", async () => {
        const slider = new SliderChallengeService(new MemoryRedis() as never);
        const { challengeId } = await slider.create();
        const { token } = await slider.verify({ challengeId, durationMs: 450, points: POINTS });
        await slider.consume(token);
        const again = await slider.consume(token).catch((error) => error);
        expect(again).toBeInstanceOf(AppError);
        expect((again as AppError).getResponse()).toMatchObject({ code: "SLIDER_REQUIRED" });
    });
});
