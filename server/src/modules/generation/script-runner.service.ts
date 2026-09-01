import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import ivm from "isolated-vm";
import { badRequest } from "../../common/errors";
import type { GeneratedBinary, GenerationRequest, ProviderCredentials } from "./provider/provider.types";
import { fetchBinary } from "./provider/openai.adapter";

type ScriptHttpRequest = { method?: string; url: string; headers?: Record<string, string>; body?: unknown; responseType?: "json" | "text" };
type ScriptResult = { images?: string[]; text?: string; url?: string };

/**
 * Executes admin-authored request scripts.
 *
 * `isolated-vm` gives a real V8 isolate with hard memory and CPU limits, unlike `node:vm` which shares
 * the host realm and is escapable. The script gets no `require`, no filesystem and no direct network:
 * its only outbound capability is a host-provided `http` callback that enforces a domain allowlist.
 * Scripts only ever run in the worker process, never in the API process.
 */
@Injectable()
export class ScriptRunnerService {
    private readonly logger = new Logger(ScriptRunnerService.name);
    private readonly memoryLimitMb: number;
    private readonly timeoutMs: number;
    private readonly allowedHosts: string[];

    constructor(config: ConfigService) {
        this.memoryLimitMb = config.get<number>("script.memoryLimitMb")!;
        this.timeoutMs = config.get<number>("script.timeoutMs")!;
        this.allowedHosts = config.get<string[]>("script.allowedHosts") ?? [];
    }

    async run(script: string, credentials: ProviderCredentials, request: GenerationRequest): Promise<{ binaries: GeneratedBinary[]; text?: string }> {
        const isolate = new ivm.Isolate({ memoryLimit: this.memoryLimitMb });
        try {
            const context = await isolate.createContext();
            const jail = context.global;
            await jail.set("global", jail.derefInto());

            // The only bridge out of the isolate. Everything else the script sees is plain data.
            await jail.set(
                "__http",
                new ivm.Reference(async (payloadJson: string) => {
                    const payload = JSON.parse(payloadJson) as ScriptHttpRequest;
                    const response = await this.fetch(payload, credentials);
                    return new ivm.ExternalCopy(response).copyInto();
                }),
            );

            await jail.set(
                "__input",
                new ivm.ExternalCopy({
                    prompt: request.prompt,
                    systemPrompt: request.systemPrompt ?? "",
                    model: request.model,
                    baseUrl: credentials.baseUrl,
                    // Reference images arrive as data URLs; the raw provider key is never exposed.
                    images: request.references.map((reference) => `data:${reference.mimeType};base64,${reference.body.toString("base64")}`),
                    params: {
                        count: request.count,
                        size: request.size ?? "",
                        quality: request.quality ?? "",
                        seconds: request.seconds ?? 0,
                        voice: request.voice ?? "",
                        format: request.audioFormat ?? "",
                    },
                }).copyInto(),
            );

            const bootstrap = await context.eval(RUNTIME_PRELUDE + `\n(async () => {\n${script}\n})()`, { promise: true, timeout: this.timeoutMs, reference: true });
            const raw = await bootstrap.copy();
            return await this.materialise(raw as ScriptResult | string | string[], request.signal);
        } catch (error) {
            this.logger.warn(`Model script failed: ${String(error)}`);
            throw badRequest("SCRIPT_FAILED", `模型调用脚本执行失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            isolate.dispose();
        }
    }

    /** Runs on the host, so this is where the allowlist and credential injection happen. */
    private async fetch(payload: ScriptHttpRequest, credentials: ProviderCredentials) {
        const url = new URL(payload.url, credentials.baseUrl);
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`Unsupported protocol: ${url.protocol}`);
        if (!this.isAllowed(url, credentials.baseUrl)) throw new Error(`Host not allowed by SCRIPT_ALLOWED_HOSTS: ${url.host}`);

        const response = await axios.request({
            method: payload.method || "POST",
            url: url.toString(),
            headers: { Authorization: `Bearer ${credentials.apiKey}`, "Content-Type": "application/json", ...(payload.headers ?? {}) },
            data: payload.body,
            responseType: payload.responseType === "text" ? "text" : "json",
            timeout: this.timeoutMs,
            validateStatus: () => true,
        });
        return { status: response.status, body: response.data };
    }

    private isAllowed(url: URL, baseUrl: string) {
        // The channel's own host is always permitted; the allowlist covers additional hosts.
        try {
            if (new URL(baseUrl).host === url.host) return true;
        } catch {
            // Malformed channel base URL: fall through to the explicit allowlist.
        }
        return this.allowedHosts.some((host) => url.host === host || url.host.endsWith(`.${host}`));
    }

    /** Scripts return URLs or data URLs; convert both into bytes we can store. */
    private async materialise(raw: ScriptResult | string | string[], signal?: AbortSignal) {
        if (typeof raw === "string") return { binaries: [await this.toBinary(raw, signal)] };
        if (Array.isArray(raw)) return { binaries: await Promise.all(raw.map((item) => this.toBinary(item, signal))) };
        if (raw?.text) return { binaries: [], text: raw.text };
        const sources = raw?.images ?? (raw?.url ? [raw.url] : []);
        if (!sources.length) throw new Error("脚本没有返回图片或文本");
        return { binaries: await Promise.all(sources.map((item) => this.toBinary(item, signal))) };
    }

    private async toBinary(source: string, signal?: AbortSignal): Promise<GeneratedBinary> {
        const dataUrl = source.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUrl) return { body: Buffer.from(dataUrl[2], "base64"), mimeType: dataUrl[1] };
        return fetchBinary(source, signal);
    }
}

/**
 * Injected into the isolate before the script body. Presents a small, plain-data API and keeps the
 * `__http` reference itself out of reach behind a wrapper.
 */
const RUNTIME_PRELUDE = `
const input = __input;
const prompt = input.prompt;
const systemPrompt = input.systemPrompt;
const model = input.model;
const baseUrl = input.baseUrl;
const images = input.images;
const params = input.params;
async function http(request) {
    const result = await __http.apply(undefined, [JSON.stringify(request)], { arguments: { copy: true }, result: { promise: true, copy: true } });
    return result;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
`;
