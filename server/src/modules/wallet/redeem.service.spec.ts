import { describe, expect, it } from "vitest";
import { AppError } from "../../common/errors";
import { MemoryRedis } from "../../test/memory-redis";
import { RedeemService } from "./redeem.service";

function errorBody(error: unknown) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).getResponse() as { code: string; message: string };
}

function emptyCardDb() {
    return {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: async () => [],
                }),
            }),
        }),
    };
}

describe("RedeemService anti-bruteforce", () => {
    it("hides whether a card exists", async () => {
        const redeem = new RedeemService(emptyCardDb() as never, new MemoryRedis() as never, {} as never);
        const error = await redeem.redeem({ userId: "user-1", code: "AAAA-BBBB-CCCC-DDDD", ip: "198.51.100.9" }).catch((item) => item);
        expect(errorBody(error)).toMatchObject({ code: "CARD_INVALID", message: "卡密无效或已使用" });
    });

    it("cools down after 10 failures in 15 minutes", async () => {
        const redeem = new RedeemService(emptyCardDb() as never, new MemoryRedis() as never, {} as never);
        for (let index = 0; index < 10; index += 1) {
            const error = await redeem.redeem({ userId: "user-2", code: "AAAA-BBBB-CCCC-DDDD", ip: "198.51.100.10" }).catch((item) => item);
            expect(errorBody(error).code).toBe("CARD_INVALID");
        }
        const cooled = await redeem.redeem({ userId: "user-2", code: "AAAA-BBBB-CCCC-DDDD", ip: "198.51.100.10" }).catch((item) => item);
        expect(errorBody(cooled)).toMatchObject({ code: "REDEEM_COOLDOWN", message: "尝试过于频繁" });
    });
});
