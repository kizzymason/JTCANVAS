import { describe, expect, it } from "vitest";
import { registrationLockError } from "./registration-policy";

describe("registrationLockError", () => {
    it("skips yearly fingerprint and IP caps for the first account", () => {
        expect(
            registrationLockError({
                isFirstUser: true,
                lockRegisteredAt: new Date(),
                ipSuccessCount: 99,
            }),
        ).toBeNull();
    });

    it("blocks a fingerprint used within 365 days", () => {
        expect(
            registrationLockError({
                isFirstUser: false,
                lockRegisteredAt: new Date(),
                ipSuccessCount: 0,
            }),
        ).toMatchObject({ code: "DEVICE_REGISTERED" });
    });

    it("allows a fingerprint after 365 days", () => {
        const registeredAt = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000);
        expect(registrationLockError({ isFirstUser: false, lockRegisteredAt: registeredAt, ipSuccessCount: 0 })).toBeNull();
    });

    it("caps successful registrations per IP at 5 in 24 hours", () => {
        expect(registrationLockError({ isFirstUser: false, lockRegisteredAt: null, ipSuccessCount: 5 })).toMatchObject({
            code: "TOO_MANY_REQUESTS",
            message: "当前网络注册次数过多，请稍后再试",
        });
    });
});
