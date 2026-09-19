/**
 * Stand-in for a channel's webhook endpoint, used to prove delivery works end-to-end against a live
 * deployment: it verifies the signature exactly the way the integration docs tell a channel to, then
 * records the result to a file for inspection.
 *
 * Usage: node acceptance-webhook-receiver.mjs <port> <secret> <outFile>
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const [, , PORT, SECRET, OUT] = process.argv;
if (!PORT || !SECRET || !OUT) {
    console.error("usage: node acceptance-webhook-receiver.mjs <port> <secret> <outFile>");
    process.exit(2);
}

const REPLAY_WINDOW_SECONDS = 300;

function verify(rawBody, header) {
    const parts = Object.fromEntries(
        header
            .split(",")
            .map((part) => part.trim().split("="))
            .filter((pair) => pair.length === 2),
    );
    const timestamp = Number(parts.t);
    if (!Number.isFinite(timestamp)) return { ok: false, why: "no timestamp" };
    if (Math.abs(Date.now() / 1000 - timestamp) > REPLAY_WINDOW_SECONDS) return { ok: false, why: "outside replay window" };
    const expected = createHmac("sha256", SECRET).update(`${timestamp}.${rawBody}`).digest("hex");
    const actual = parts.v1 ?? "";
    if (actual.length !== expected.length) return { ok: false, why: "length mismatch" };
    return { ok: timingSafeEqual(Buffer.from(expected), Buffer.from(actual)), why: "hmac" };
}

createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
        const header = request.headers["x-jt-signature"] ?? "";
        const result = verify(raw, String(header));
        const record = {
            at: new Date().toISOString(),
            event: request.headers["x-jt-event"] ?? "",
            signatureHeader: header,
            signatureValid: result.ok,
            why: result.why,
            // Also prove a tampered body fails, which is the property that actually matters.
            tamperedRejected: !verify(`${raw}x`, String(header)).ok,
            body: raw,
        };
        appendFileSync(OUT, `${JSON.stringify(record)}\n`);
        console.log(JSON.stringify(record));
        response.writeHead(result.ok ? 200 : 400, { "content-type": "application/json" });
        response.end(JSON.stringify({ received: result.ok }));
    });
}).listen(Number(PORT), "0.0.0.0", () => console.log(`listening on ${PORT}`));
