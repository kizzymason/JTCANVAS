import fastify from "fastify";
import multipart from "@fastify/multipart";
import { describe, expect, it } from "vitest";
import { parseOpenApiMultipart } from "./multipart-body";

describe("multipart downstream requests", () => {
    it("returns the OpenAI envelope for hook validation failures", async () => {
        const app = fastify();
        await app.register(multipart);
        app.addHook("preValidation", parseOpenApiMultipart);
        app.post("/api/v1/videos", async () => ({ unexpected: true }));
        try {
            const response = await app.inject({ method: "POST", url: "/api/v1/videos", headers: { "content-type": "multipart/form-data; boundary=t" }, payload: '--t\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{broken\r\n--t--\r\n' });
            expect(response.statusCode).toBe(400);
            expect(response.json()).toMatchObject({ error: { type: "invalid_request_error", code: "invalid_json", param: "metadata" } });
        } finally { await app.close(); }
    });
    it("normalizes SDK files, JSON metadata and booleans before idempotency", async () => {
        const app = fastify();
        await app.register(multipart);
        app.addHook("preValidation", parseOpenApiMultipart);
        app.post("/api/v1/videos", async (req) => req.body);
        const boundary = "test-boundary";
        const fields = [
            'Content-Disposition: form-data; name="model"\r\n\r\nseedance-2-0-fast-NSFW',
            'Content-Disposition: form-data; name="generate_audio"\r\n\r\nfalse',
            'Content-Disposition: form-data; name="metadata"\r\n\r\n{"resolution":"720p"}',
            'Content-Disposition: form-data; name="input_reference"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nimage-bytes',
        ];
        try {
            const response = await app.inject({ method: "POST", url: "/api/v1/videos", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: `--${boundary}\r\n${fields.join(`\r\n--${boundary}\r\n`)}\r\n--${boundary}--\r\n` });
            expect(response.statusCode).toBe(200);
            expect(response.json()).toMatchObject({ generate_audio: false, metadata: { resolution: "720p" }, input_reference: [{ image_url: `data:image/png;base64,${Buffer.from("image-bytes").toString("base64")}` }] });
        } finally { await app.close(); }
    });
});
