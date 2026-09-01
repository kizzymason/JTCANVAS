import { createHash } from "node:crypto";

/**
 * Rainbow 易支付 / Z-Pay MD5 sign.
 * ASCII-sort keys, skip `sign`, `sign_type` and empty values, then md5(k=v&k=v + KEY) lowercase.
 * @see https://z-pay.cn/doc.html
 */
export function epaySign(params: Record<string, string>, key: string) {
    const payload = Object.keys(params)
        .filter((name) => name !== "sign" && name !== "sign_type" && params[name] !== "")
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map((name) => `${name}=${params[name]}`)
        .join("&");
    return createHash("md5").update(payload + key, "utf8").digest("hex");
}

export function epayVerify(params: Record<string, string>, key: string) {
    const expected = epaySign(params, key);
    const actual = (params.sign ?? "").toLowerCase();
    return Boolean(actual) && expected === actual;
}

export function flattenQuery(query: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        out[name] = Array.isArray(value) ? String(value[0] ?? "") : String(value);
    }
    return out;
}
