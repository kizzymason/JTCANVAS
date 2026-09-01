import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppError } from "../../common/errors";
import { assertPublicFileToken, isPublicHttpUrl, publicFileAbsoluteUrl, publicFileToken } from "./public-file-url";

const hmac = (message: string) => createHmac("sha256", Buffer.alloc(32, 7)).update(message).digest("base64url");

describe("public file URLs for PiAPI", () => {
    it("accepts public http(s) hosts and rejects loopback or data URIs", () => {
        expect(isPublicHttpUrl("https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg")).toBe(true);
        expect(isPublicHttpUrl("http://cdn.example.com/a.png")).toBe(true);
        expect(isPublicHttpUrl("https://localhost/api/files/image:1")).toBe(false);
        expect(isPublicHttpUrl("http://127.0.0.1:4000/api/files/x")).toBe(false);
        expect(isPublicHttpUrl("https://192.168.1.8/a.png")).toBe(false);
        expect(isPublicHttpUrl("data:image/png;base64,aaa")).toBe(false);
        expect(isPublicHttpUrl("/api/files/image:abc")).toBe(false);
    });

    it("round-trips a token and rejects a tampered or expired one", () => {
        const exp = Math.floor(Date.now() / 1000) + 60;
        const token = publicFileToken(hmac, "image:abc", exp);
        expect(() => assertPublicFileToken(hmac, "image:abc", token)).not.toThrow();
        expect(() => assertPublicFileToken(hmac, "image:other", token)).toThrow(AppError);
        expect(() => assertPublicFileToken(hmac, "image:abc", publicFileToken(hmac, "image:abc", Math.floor(Date.now() / 1000) - 1))).toThrow(AppError);
        expect(publicFileAbsoluteUrl("https://jingtiang.com", "image:abc", token)).toContain("/api/files/image%3Aabc/token/");
        expect(publicFileAbsoluteUrl("https://jingtiang.com", "image:abc", token)).not.toContain("?token=");
    });
});
