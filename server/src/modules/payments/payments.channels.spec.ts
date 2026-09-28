import { describe, expect, it } from "vitest";

import { PaymentsService } from "./payments.service";

/**
 * 充值弹窗的支付选项必须按「渠道」给出：两个渠道都能收支付宝时要分别出现，
 * 不能因为支付方式相同就被去重成一个（前台按渠道名称让用户选择）。
 * 纯逻辑测试：不连数据库、不请求上游，只验证目录组装规则。
 */
type Option = { channelId: string; name: string; method: string; label: string };

function collect(rows: Array<{ id: string; name: string; methods: string[] }>): Option[] {
    const service = new PaymentsService(null as never, null as never, null as never, null as never, null as never, null as never);
    const call = (service as unknown as { collectChannelOptions: (channels: unknown[]) => Option[] }).collectChannelOptions.bind(service);
    return call(rows as unknown[]);
}

describe("PaymentsService.collectChannelOptions", () => {
    it("同一支付方式的多个渠道分别保留，并以渠道名称作为标签", () => {
        const options = collect([
            { id: "ch-a", name: "支付宝A", methods: ["alipay"] },
            { id: "ch-b", name: "支付宝B", methods: ["alipay"] },
        ]);

        expect(options.map((item) => item.channelId)).toEqual(["ch-a", "ch-b"]);
        expect(options.map((item) => item.label)).toEqual(["支付宝A", "支付宝B"]);
        expect(options.map((item) => item.name)).toEqual(["支付宝A", "支付宝B"]);
        expect(options.every((item) => item.method === "alipay")).toBe(true);
    });

    it("单个渠道支持多种方式时，标签补上方式名避免同名选项", () => {
        const options = collect([{ id: "ch-all", name: "聚合支付", methods: ["alipay", "wxpay"] }]);

        expect(options.map((item) => item.label)).toEqual(["聚合支付 · 支付宝", "聚合支付 · 微信支付"]);
        expect(options.map((item) => item.method)).toEqual(["alipay", "wxpay"]);
        expect(new Set(options.map((item) => item.channelId))).toEqual(new Set(["ch-all"]));
    });

    it("忽略未知支付方式与渠道内重复项，且不改变渠道原有顺序", () => {
        const options = collect([
            { id: "ch-1", name: "渠道一", methods: ["alipay", "alipay", "unknown", ""] },
            { id: "ch-2", name: "渠道二", methods: ["wxpay"] },
        ]);

        expect(options.map((item) => `${item.channelId}:${item.method}`)).toEqual(["ch-1:alipay", "ch-2:wxpay"]);
    });

    it("没有任何可用渠道时返回空列表（前台据此显示不可用）", () => {
        expect(collect([])).toEqual([]);
    });
});
