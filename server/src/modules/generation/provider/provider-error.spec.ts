import { describe, expect, it } from "vitest";
import { AppError } from "../../../common/errors";
import {
    UPSTREAM_MAINTENANCE_MESSAGE,
    friendlyUpstreamError,
    isUpstreamAccountFailure,
    isUpstreamCreditFailure,
    providerError,
    providerFailureDetails,
} from "./provider-error";

/** The exact body WhatsToken answers with when its own account runs out of credit. */
const creditBody = {
    error: { code: "insufficient_user_quota", message: "账户余额不足，视频生成按秒预扣冻结：0.3Dollar/秒 × 15秒 = 4.5Dollar" },
};

function upstream(status: number, data: unknown) {
    return { isAxiosError: true, config: { headers: { Authorization: "Bearer private-token-value" } }, response: { status, data } };
}

describe("upstream credit failures", () => {
    it("shows the maintenance wording instead of the relay's invoice", () => {
        const error = providerError(upstream(402, creditBody)) as AppError;
        expect(error.getResponse()).toMatchObject({ message: UPSTREAM_MAINTENANCE_MESSAGE });
        expect(providerFailureDetails(error)).toMatchObject({ upstreamStatus: 402, upstreamCode: "insufficient_user_quota" });
        // admins keep the sanitized cause, customers never see it
        expect(providerFailureDetails(error)).toMatchObject({ upstreamMessage: expect.stringContaining("按秒预扣") });
        expect(providerFailureDetails(error)).toMatchObject({ upstreamMessage: expect.not.stringContaining("private-token-value") });
    });

    it("masks quota wording on other statuses too", () => {
        const error = providerError(upstream(429, { error: { message: "insufficient_user_quota" } })) as AppError;
        expect(error.getResponse()).toMatchObject({ message: UPSTREAM_MAINTENANCE_MESSAGE });
    });

    it("leaves ordinary upstream rejections readable", () => {
        const error = providerError(upstream(400, { error: { code: "InvalidSize", message: "size is invalid" } })) as AppError;
        expect(error.getResponse()).toMatchObject({ message: "Upstream HTTP 400: size is invalid" });
    });

    it("never masks the customer's own wallet shortage", () => {
        // The wallet error must keep telling people to top up.
        expect(friendlyUpstreamError("余额不足，请先充值")).toBe("余额不足，请先充值");
        expect(isUpstreamCreditFailure("余额不足，请先充值")).toBe(false);
    });

    it("masks pool failures and is idempotent", () => {
        const pool = "PiAPI 账号池没有可用账号，请在管理后台补充或刷新余额";
        expect(isUpstreamAccountFailure(pool)).toBe(true);
        expect(friendlyUpstreamError(pool)).toBe(UPSTREAM_MAINTENANCE_MESSAGE);
        expect(friendlyUpstreamError(UPSTREAM_MAINTENANCE_MESSAGE)).toBe(UPSTREAM_MAINTENANCE_MESSAGE);
        expect(friendlyUpstreamError("Upstream HTTP 402: 账户余额不足，视频生成按秒预扣冻结：0.3Dollar/秒 × 15秒 = 4.5Dollar"))
            .toBe(UPSTREAM_MAINTENANCE_MESSAGE);
        expect(friendlyUpstreamError("该模型最低生成时长4S")).toBe("该模型最低生成时长4S");
    });
});
