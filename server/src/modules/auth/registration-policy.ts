export const FINGERPRINT_LOCK_MS = 365 * 24 * 60 * 60 * 1000;
export const IP_REGISTER_WINDOW_MS = 24 * 60 * 60 * 1000;
export const IP_REGISTER_SUCCESS_LIMIT = 5;
export const REGISTER_HOURLY_LIMIT = 20;
export const REGISTER_HOURLY_WINDOW_SECONDS = 60 * 60;

export function fingerprintBlocked(registeredAt: Date, now = new Date()) {
    return now.getTime() - registeredAt.getTime() < FINGERPRINT_LOCK_MS;
}

/** First account on an empty database becomes admin and skips the yearly/IP caps. */
export function registrationLockError(input: { isFirstUser: boolean; lockRegisteredAt: Date | null; ipSuccessCount: number; now?: Date }): { code: string; message: string } | null {
    if (input.isFirstUser) return null;
    if (input.lockRegisteredAt && fingerprintBlocked(input.lockRegisteredAt, input.now)) {
        return { code: "DEVICE_REGISTERED", message: "该设备已注册过账号，请直接登录" };
    }
    if (input.ipSuccessCount >= IP_REGISTER_SUCCESS_LIMIT) {
        return { code: "TOO_MANY_REQUESTS", message: "请稍后再试" };
    }
    return null;
}
